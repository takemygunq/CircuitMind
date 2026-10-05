import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVR_PINS, AvrMachine, CLOCK_HZ } from './avr';
import { HexError, parseIntelHex } from './hex';

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, '__fixtures__', `${name}.hex`), 'utf8');
const ms = (n: number) => (n * CLOCK_HZ) / 1000;
/** Прогоняет машину по кадрам и собирает серийный вывод. */
function boot(name: string) {
  const m = new AvrMachine(fixture(name));
  let out = '';
  m.onSerial((t) => (out += t));
  return { m, serial: () => out };
}

describe('parseIntelHex', () => {
  it('loads data records at their addresses', () => {
    const img = parseIntelHex(':0400000001020304F2\n:00000001FF\n', 64);
    expect([...img.slice(0, 5)]).toEqual([1, 2, 3, 4, 0xff]);
  });
  it('honours extended address records', () => {
    const img = parseIntelHex(':020000021000EC\n:0100000042BD\n:00000001FF\n', 0x10010);
    expect(img[0x10000]).toBe(0x42);
  });
  it('rejects broken input', () => {
    expect(() => parseIntelHex(':0400000001020304F3\n:00000001FF')).toThrow(/checksum/);
    expect(() => parseIntelHex('0400000001020304F2')).toThrow(HexError);
    expect(() => parseIntelHex(':0400000001020304F2')).toThrow(/end-of-file/);
    expect(() => parseIntelHex(':00000001FF\n:0400000001020304F2')).toThrow(/after the end/);
    expect(() => parseIntelHex(':0400100001020304E2\n:00000001FF', 8)).toThrow(/beyond flash/);
    expect(() => parseIntelHex(':00000001FZ')).toThrow(HexError);
  });
  it('parses a real compiled firmware', () => {
    const img = parseIntelHex(fixture('blink'));
    expect(img.length).toBe(32768);
    expect(img[0]).toBe(0x0c); // vector table: JMP
    expect(img.some((b, i) => i > 200 && b !== 0xff)).toBe(true);
  });
});

describe('blink firmware', () => {
  it('toggles D13 every 500 ms and prints a counter', () => {
    const { m, serial } = boot('blink');
    const samples: string[] = [];
    for (let t = 0; t < 2500; t += 100) {
      m.run(ms(100));
      samples.push(m.pinState('D13'));
    }
    expect(m.pinState('D12')).toBe('input'); // не настроенные пины — входы
    // за 2.5 с светодиод должен побывать и HIGH, и LOW
    expect(new Set(samples)).toEqual(new Set(['high', 'low']));
    const highRuns = samples
      .join(',')
      .split('low')
      .filter((s) => s.includes('high')).length;
    expect(highRuns).toBeGreaterThanOrEqual(2);
    expect(serial()).toContain('tick 0');
    expect(serial()).toContain('tick 1');
    expect(m.millis).toBeCloseTo(2500, -1);
  });
  it('keeps real time: the first half second is HIGH, the next is LOW', () => {
    const { m } = boot('blink');
    m.run(ms(250));
    expect(m.pinState('D13')).toBe('high');
    m.run(ms(500)); // t = 750 мс
    expect(m.pinState('D13')).toBe('low');
  });
});

describe('inputs', () => {
  it('button on D2 (INPUT_PULLUP) drives D13', () => {
    const { m } = boot('button');
    m.run(ms(20));
    expect(m.pinState('D2')).toBe('pullup');
    m.setInput('D2', true);
    m.run(ms(5));
    expect(m.pinState('D13')).toBe('low');
    m.setInput('D2', false); // нажатие
    m.run(ms(5));
    expect(m.pinState('D13')).toBe('high');
    m.setInput('D2', true);
    m.run(ms(5));
    expect(m.pinState('D13')).toBe('low');
  });

  it('analogRead reflects the voltage on A0', () => {
    const { m, serial } = boot('adc');
    m.setAnalog('A0', 2.5);
    m.run(ms(350));
    const values = serial().trim().split(/\r?\n/).map(Number);
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(values.at(-1)! - 512)).toBeLessThanOrEqual(2);
    m.setAnalog('A0', 5);
    m.run(ms(350));
    expect(Number(serial().trim().split(/\r?\n/).at(-1))).toBeGreaterThanOrEqual(1022);
    m.setAnalog('A0', 0);
    m.run(ms(350));
    expect(Number(serial().trim().split(/\r?\n/).at(-1))).toBe(0);
  });
});

describe('PWM', () => {
  it('analogWrite(9, 64) gives ≈25 % duty and many toggles', () => {
    const { m } = boot('pwm');
    m.run(ms(20)); // запуск и настройка таймера
    m.resetWindow();
    m.run(ms(66)); // несколько периодов ШИМ (≈490 Гц)
    const w = m.window('D9');
    expect(w.toggles).toBeGreaterThan(10);
    expect(w.duty).toBeGreaterThan(0.22);
    expect(w.duty).toBeLessThan(0.28);
  });
  it('a constant output reports 0 or 1 duty and no toggles', () => {
    const { m } = boot('button');
    m.setInput('D2', false);
    m.run(ms(10));
    m.resetWindow();
    m.run(ms(10));
    expect(m.window('D13')).toEqual({ duty: 1, toggles: 0 });
    m.setInput('D2', true);
    m.run(ms(2));
    m.resetWindow();
    m.run(ms(10));
    expect(m.window('D13')).toEqual({ duty: 0, toggles: 0 });
  });
});

describe('serial', () => {
  it('echoes uppercase bytes written to the UART', () => {
    const { m, serial } = boot('echo');
    m.run(ms(100));
    expect(serial()).toContain('ready');
    m.serialWrite('hello');
    m.run(ms(100));
    expect(serial()).toContain('HELLO');
    expect(m.baudRate).toBeGreaterThan(9500); // UBRR = 103 даёт 9615 бод — стандартная аппаратная погрешность
    expect(m.baudRate).toBeLessThan(9700);
  });
});

describe('pin map', () => {
  it('covers the 14 digital and 6 analog pins of the Uno', () => {
    expect(AVR_PINS).toHaveLength(20);
    const { m } = boot('blink');
    for (const p of AVR_PINS) expect(['low', 'high', 'input', 'pullup']).toContain(m.pinState(p));
  });
  it('is quick enough to run in real time', () => {
    const { m } = boot('blink');
    const t0 = performance.now();
    m.run(ms(1000));
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(2000); // 1 с эмулируемого времени быстрее, чем за 2 с реального
  });
});
