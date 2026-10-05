import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { blinkUno, weatherEsp32 } from '../fixtures';
import { getBoard } from '../library';
import type { Language, Project } from '../schema';
import {
  PIN_BLOCK_END,
  PIN_BLOCK_START,
  buildPinBindings,
  buildPreamble,
  composeFirmware,
  describeIssue,
  hasErrors,
  lintFirmware,
  pinExpr,
  templateFirmware,
} from './index';

const esp = getBoard('esp32-devkit-v1')!;
const uno = getBoard('arduino-uno')!;
const pico = getBoard('raspberry-pi-pico')!;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('pinExpr', () => {
  it.each([
    ['D13', 'arduino', '13'],
    ['A0', 'arduino', 'A0'],
    ['GPIO18', 'arduino', '18'],
    ['GPIO18', 'micropython', '18'],
    ['GPIO18', 'esp-idf', 'GPIO_NUM_18'],
    ['GPIO18', 'circuitpython', 'board.IO18'],
    ['GP4', 'micropython', '4'],
    ['GP4', 'circuitpython', 'board.GP4'],
    ['GP4', 'arduino', '4'],
  ] as const)('%s / %s → %s', (pin, lang, expr) => expect(pinExpr(pin, lang)).toBe(expr));
  it('returns undefined for impossible combinations', () => {
    expect(pinExpr('D13', 'micropython')).toBeUndefined();
    expect(pinExpr('GP4', 'esp-idf')).toBeUndefined();
    expect(pinExpr('VIN', 'arduino')).toBeUndefined();
  });
});

describe('buildPinBindings', () => {
  const b = buildPinBindings(weatherEsp32, esp);
  it('names constants from codeHints and covers every wired GPIO', () => {
    expect(Object.fromEntries(b.map((x) => [x.boardPin, x.name]))).toEqual({
      GPIO4: 'DHT',
      GPIO18: 'LED',
      GPIO19: 'BUTTON',
      GPIO21: 'SDA',
      GPIO22: 'SCL',
    });
  });
  it('infers roles and follows resistors to the real peer', () => {
    const byPin = Object.fromEntries(b.map((x) => [x.boardPin, x]));
    expect(byPin.GPIO18).toMatchObject({ role: 'output', peers: ['led1:anode'] });
    expect(byPin.GPIO19.role).toBe('input_pullup');
    expect(byPin.GPIO21.role).toBe('i2c_sda');
    expect(byPin.GPIO22.role).toBe('i2c_scl');
    expect(byPin.GPIO4.role).toBe('bidirectional');
  });
  it('derives names when the project has no hints and keeps them unique', () => {
    const p = clone(weatherEsp32);
    delete p.codeHints;
    const names = buildPinBindings(p, esp).map((x) => x.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('LED1');
    expect(names).toContain('BTN1');
    expect(names).toContain('DHT1_DATA');
    expect(names.every((n) => /^[A-Z_][A-Z0-9_]*$/.test(n))).toBe(true);
  });
  it('works for the Uno blink example', () => {
    expect(buildPinBindings(blinkUno, uno)).toEqual([
      expect.objectContaining({ name: 'LED', boardPin: 'D13', role: 'output' }),
    ]);
  });
});

describe('preamble', () => {
  const b = buildPinBindings(weatherEsp32, esp);
  it('declares constants in each language', () => {
    expect(buildPreamble(b, 'arduino', esp)).toContain('constexpr auto LED = uint8_t(18);');
    expect(buildPreamble(b, 'esp-idf', esp)).toContain('#define LED GPIO_NUM_18');
    expect(buildPreamble(b, 'micropython', esp)).toContain('LED = 18');
    expect(buildPreamble(b, 'circuitpython', esp)).toContain('LED = board.IO18');
  });
  it('is wrapped in markers and composes with a body', () => {
    const p = buildPreamble(b, 'micropython', esp);
    expect(p).toContain(PIN_BLOCK_START);
    expect(p.trimEnd().endsWith(`${PIN_BLOCK_END} ====`)).toBe(true);
    expect(composeFirmware(p, '\n\nprint(1)\n\n')).toBe(`${p}\nprint(1)\n`);
  });
});

describe('template firmware passes its own lint in every language', () => {
  const cases: [Project, typeof esp, Language][] = [
    [weatherEsp32, esp, 'arduino'],
    [weatherEsp32, esp, 'micropython'],
    [weatherEsp32, esp, 'esp-idf'],
    [weatherEsp32, esp, 'circuitpython'],
    [blinkUno, uno, 'arduino'],
  ];
  it.each(cases)('%s / %s', (project, board, lang) => {
    const code = templateFirmware(project, board, lang);
    const issues = lintFirmware(code, lang, buildPinBindings(project, board), board);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(code.length).toBeGreaterThan(200);
  });
  it('Arduino weather template uses the project libraries and constants', () => {
    const code = templateFirmware(weatherEsp32, esp, 'arduino');
    expect(code).toContain('#include <DHT.h>');
    expect(code).toContain('DHT dht(DHT, DHT22);');
    expect(code).toContain('Wire.begin(SDA, SCL);');
    expect(code).toContain('pinMode(BUTTON, INPUT_PULLUP);');
    expect(code).toContain('void setup()');
  });
  it('Uno blink template toggles the LED pin constant', () => {
    expect(templateFirmware(blinkUno, uno, 'arduino')).toMatch(/digitalWrite\(LED, ledState\)/);
  });
  it('Pico micropython uses GP pin numbers', () => {
    const p = clone(blinkUno);
    p.boardId = 'raspberry-pi-pico';
    p.connections = [
      { from: 'board:GP15', to: 'R1:1' },
      { from: 'R1:2', to: 'led1:anode' },
      { from: 'led1:cathode', to: 'board:GND1' },
    ];
    const code = templateFirmware(p, pico, 'micropython');
    expect(code).toContain('LED1 = 15');
    expect(code).toContain('Pin(LED1, Pin.OUT)');
  });
});

describe('Python templates are syntactically valid', () => {
  const python = spawnSync('python3', ['--version']).status === 0;
  const parses = (code: string) =>
    spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: code })
      .status === 0;
  it.skipIf(!python).each(['micropython', 'circuitpython'] as const)(
    'weather station / %s',
    (lang) => {
      expect(parses(templateFirmware(weatherEsp32, esp, lang))).toBe(true);
    },
  );
  it.skipIf(!python)('Pico blink and the checker itself rejects broken code', () => {
    const p = clone(blinkUno);
    p.boardId = 'raspberry-pi-pico';
    p.connections = [
      { from: 'board:GP15', to: 'R1:1' },
      { from: 'R1:2', to: 'led1:anode' },
      { from: 'led1:cathode', to: 'board:GND1' },
    ];
    expect(parses(templateFirmware(p, pico, 'micropython'))).toBe(true);
    expect(parses('while True:\n    a = 1\n  b = 2\n')).toBe(false);
  });
});

describe('lintFirmware', () => {
  const b = buildPinBindings(weatherEsp32, esp);
  const good = templateFirmware(weatherEsp32, esp, 'arduino');
  const lint = (code: string, lang: Language = 'arduino') => lintFirmware(code, lang, b, esp);
  const codes = (issues: ReturnType<typeof lint>) => issues.map((i) => `${i.severity}:${i.code}`);

  it('accepts the template', () => {
    expect(codes(lint(good)).filter((c) => c.startsWith('error'))).toEqual([]);
  });
  it('rejects empty and oversized code', () => {
    expect(codes(lint('  '))).toEqual(['error:empty']);
    expect(codes(lint(good + 'x'.repeat(70_000)))).toContain('error:too_long');
  });
  it('requires the pin block and keeps constants intact', () => {
    expect(codes(lint('void setup(){}\nvoid loop(){}'))).toContain('error:pin_block_missing');
    expect(codes(lint(good.replace('uint8_t(18)', 'uint8_t(5)')))).toContain(
      'error:pin_constant_changed',
    );
    expect(codes(lint(good.replace(/constexpr auto LED[^\n]*\n/, '')))).toContain(
      'error:pin_constant_missing',
    );
  });
  it('requires an entry point', () => {
    const noLoop = good.replace(/void loop\(\)/, 'void lop()');
    expect(codes(lint(noLoop))).toContain('error:missing_entrypoint');
    const idf = templateFirmware(weatherEsp32, esp, 'esp-idf').replace('app_main', 'main_app');
    expect(codes(lintFirmware(idf, 'esp-idf', buildPinBindings(weatherEsp32, esp), esp))).toContain(
      'error:missing_entrypoint',
    );
  });
  it('catches code in the wrong language', () => {
    expect(codes(lint(good + '\nimport machine\n'))).toContain('error:wrong_language');
    const py =
      templateFirmware(weatherEsp32, esp, 'micropython') +
      '\n#include <Arduino.h>\nvoid setup() {}\n';
    expect(codes(lintFirmware(py, 'micropython', b, esp))).toContain('error:wrong_language');
  });
  it('warns about hard-coded wired pins and rejects pins nothing is wired to', () => {
    const warn = lint(good + '\nvoid x() { digitalWrite(18, HIGH); }\n');
    expect(warn.find((i) => i.code === 'raw_pin_literal')).toMatchObject({
      severity: 'warning',
      params: { pin: '18', name: 'LED' },
    });
    const bad = lint(good + '\nvoid y() { pinMode(27, OUTPUT); }\n');
    expect(bad.find((i) => i.code === 'pin_not_wired')).toMatchObject({
      severity: 'error',
      params: { pin: '27' },
    });
    expect(hasErrors(bad)).toBe(true);
  });
  it('checks I²C pins passed to Wire.begin and MicroPython Pin()', () => {
    expect(codes(lint(good + '\nvoid z() { Wire.begin(33, 32); }\n'))).toContain(
      'error:pin_not_wired',
    );
    const py = templateFirmware(weatherEsp32, esp, 'micropython') + '\np = Pin(27, Pin.OUT)\n';
    expect(codes(lintFirmware(py, 'micropython', b, esp))).toContain('error:pin_not_wired');
  });
  it('ignores pins inside comments and the pin block', () => {
    expect(codes(lint(good + '\n// pinMode(27, OUTPUT);\n'))).not.toContain('error:pin_not_wired');
  });
  it('produces readable messages', () => {
    const msg = lint(good + '\nvoid y() { pinMode(27, OUTPUT); }\n')
      .map(describeIssue)
      .join(' ');
    expect(msg).toContain('Pin 27');
    expect(msg).toContain('line');
  });
  it('lints Python-family pins too', () => {
    const idf =
      templateFirmware(weatherEsp32, esp, 'esp-idf') +
      '\nvoid q(void){ gpio_set_level(GPIO_NUM_27, 1); }\n';
    expect(codes(lintFirmware(idf, 'esp-idf', b, esp))).toContain('error:pin_not_wired');
    const cp =
      templateFirmware(weatherEsp32, esp, 'circuitpython') +
      '\nx = digitalio.DigitalInOut(board.IO27)\n';
    expect(codes(lintFirmware(cp, 'circuitpython', b, esp))).toContain('error:pin_not_wired');
  });
});
