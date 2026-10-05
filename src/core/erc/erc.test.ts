import { describe, expect, it } from 'vitest';
import { demoProjects } from '../fixtures';
import { getBoard, getComponent } from '../library';
import { Project, type BoardDef, type ComponentDef } from '../schema';
import {
  RULES,
  formatViolation,
  runErc,
  violationsForAi,
  type ErcOptions,
  type RuleId,
} from './index';
import { en } from '../../i18n/en';
import { ru } from '../../i18n/ru';
import { uk } from '../../i18n/uk';

type PartSpec = [id: string, component: string, value?: string];

function build(
  boardId: string,
  parts: PartSpec[],
  wires: [string, string][],
  extra: Record<string, unknown> = {},
): Project {
  return Project.parse({
    title: 'T',
    description: 'test circuit',
    boardId,
    parts: parts.map(([instanceId, componentId, value]) => ({
      instanceId,
      componentId,
      ...(value ? { value } : {}),
    })),
    connections: wires.map(([from, to]) => ({ from, to })),
    power: { source: 'usb', voltage: 5, budgetMa: 500 },
    ...extra,
  });
}
const rules = (p: Project, o?: ErcOptions) => runErc(p, o).violations.map((v) => v.rule);
const find = (p: Project, rule: RuleId, o?: ErcOptions) =>
  runErc(p, o).violations.filter((v) => v.rule === rule);
const clean = (p: Project, o?: ErcOptions) => {
  const r = runErc(p, o);
  expect(r.violations.map((v) => `${v.severity}:${v.rule}`)).toEqual([]);
};

const ESP = 'esp32-devkit-v1';
const UNO = 'arduino-uno';
const PICO = 'raspberry-pi-pico';

/** HC-SR04 на 5 В (VIN) для проверок уровней. */
const hc = (echoTo: [string, string][], extraParts: PartSpec[] = []) =>
  build(
    ESP,
    [['hc', 'hc-sr04'], ...extraParts],
    [['board:VIN', 'hc:VCC'], ['board:GND1', 'hc:GND'], ['board:GPIO19', 'hc:TRIG'], ...echoTo],
  );

describe('demo projects', () => {
  const good = demoProjects.filter((d) => d.id !== 'broken-esp32');
  it.each(good.map((d) => [d.id, d.project] as const))('%s is ERC-clean', (_id, project) =>
    clean(project),
  );

  it('the deliberately broken example is caught', () => {
    const report = runErc(demoProjects.find((d) => d.id === 'broken-esp32')!.project);
    const found = new Set(report.violations.map((v) => v.rule));
    for (const rule of [
      'level_overvoltage',
      'part_supply_voltage',
      'led_no_resistor',
      'inductive_direct_gpio',
      'strapping_pin_used',
    ] as const)
      expect(found, rule).toContain(rule);
    expect(report.ok).toBe(false);
  });
});

describe('levels', () => {
  it('flags 5 V ECHO wired straight into a 3.3 V ESP32 pin', () => {
    const v = find(hc([['hc:ECHO', 'board:GPIO18']]), 'level_overvoltage');
    expect(v).toHaveLength(1);
    expect(v[0].params).toMatchObject({ v: 5, max: 3.6, how: 'direct' });
  });
  it('accepts a resistor divider 1k / 2k (5 V → 3.33 V)', () => {
    const p = hc(
      [
        ['hc:ECHO', 'R1:1'],
        ['R1:2', 'board:GPIO18'],
        ['R1:2', 'R2:1'],
        ['R2:2', 'board:GND1'],
      ],
      [
        ['R1', 'resistor', '1k'],
        ['R2', 'resistor', '2k'],
      ],
    );
    expect(rules(p)).not.toContain('level_overvoltage');
  });
  it('rejects a divider that is too weak (1k / 1k → 2.5 V is fine, 100 Ω / 10 k → 4.95 V is not)', () => {
    const weak = hc(
      [
        ['hc:ECHO', 'R1:1'],
        ['R1:2', 'board:GPIO18'],
        ['R1:2', 'R2:1'],
        ['R2:2', 'board:GND1'],
      ],
      [
        ['R1', 'resistor', '100'],
        ['R2', 'resistor', '10k'],
      ],
    );
    expect(find(weak, 'level_overvoltage')[0].params.how).toBe('divider');
  });
  it('is not satisfied by a series resistor alone', () => {
    const p = hc(
      [
        ['hc:ECHO', 'R1:1'],
        ['R1:2', 'board:GPIO18'],
      ],
      [['R1', 'resistor', '1k']],
    );
    expect(find(p, 'level_overvoltage')[0].params.how).toBe('series');
  });
  it('accepts a level shifter module', () => {
    const p = hc(
      [
        ['hc:ECHO', 'ls:HV1'],
        ['ls:LV1', 'board:GPIO18'],
        ['ls:HV', 'board:VIN'],
        ['ls:LV', 'board:3V3'],
        ['ls:GND', 'board:GND1'],
      ],
      [['ls', 'level-shifter-4ch']],
    );
    clean(p);
  });
  it('warns when a 3.3 V driver cannot reach the receiver VIH', () => {
    const picky: ComponentDef = {
      ...getComponent('hc-sr04')!,
      id: 'picky',
      pins: getComponent('hc-sr04')!.pins.map((p) =>
        p.id === 'TRIG' ? { ...p, minHighV: 3.5 } : p,
      ),
    };
    const o: ErcOptions = { getComponent: (id) => (id === 'picky' ? picky : getComponent(id)) };
    const p = build(
      ESP,
      [['d', 'picky']],
      [
        ['board:VIN', 'd:VCC'],
        ['board:GND1', 'd:GND'],
        ['board:GPIO5', 'd:TRIG'],
      ],
    );
    expect(find(p, 'level_undervoltage', o)).toHaveLength(1);
  });
  it('accepts 3.3 V ESP32 outputs into 5 V HC-SR04 TRIG (VIH 2 V)', () => {
    expect(rules(hc([]))).not.toContain('level_undervoltage');
  });
});

describe('currents', () => {
  it('pin_overcurrent on ESP32 for a 47 Ω LED resistor', () => {
    const p = build(
      ESP,
      [
        ['R1', 'resistor', '47'],
        ['led', 'led-5mm-red'],
      ],
      [
        ['board:GPIO18', 'R1:1'],
        ['R1:2', 'led:anode'],
        ['led:cathode', 'board:GND1'],
      ],
    );
    expect(find(p, 'pin_overcurrent')[0].params).toMatchObject({ pin: 'GPIO18', limit: 12 });
  });
  it('accepts a 220 Ω LED resistor on ESP32 (≈6 mA)', () => {
    clean(
      build(
        ESP,
        [
          ['R1', 'resistor', '220'],
          ['led', 'led-5mm-red'],
        ],
        [
          ['board:GPIO18', 'R1:1'],
          ['R1:2', 'led:anode'],
          ['led:cathode', 'board:GND1'],
        ],
      ),
    );
  });
  it('flags the Uno D13 LED with 100 Ω (30 mA): pin and LED overcurrent', () => {
    const p = build(
      UNO,
      [
        ['R1', 'resistor', '100'],
        ['led', 'led-5mm-red'],
      ],
      [
        ['board:D13', 'R1:1'],
        ['R1:2', 'led:anode'],
        ['led:cathode', 'board:GND1'],
      ],
    );
    const r = rules(p);
    expect(r).toContain('pin_overcurrent');
    expect(r).toContain('led_overcurrent');
  });
  it('counts a pull-up as sink current for the pin', () => {
    const p = build(
      ESP,
      [['R1', 'resistor', '100']],
      [
        ['board:GPIO18', 'R1:1'],
        ['R1:2', 'board:3V3'],
      ],
    );
    expect(rules(p)).toContain('pin_overcurrent'); // 3.3 V / 100 Ω = 33 mA
  });
  it('gpio_total_overcurrent on a Pico with five ~11 mA LEDs (limit 50 mA)', () => {
    const pins = ['GP2', 'GP3', 'GP4', 'GP5', 'GP6'];
    const parts: PartSpec[] = pins.flatMap((_, i): PartSpec[] => [
      [`R${i}`, 'resistor', '120'],
      [`L${i}`, 'led-5mm-red'],
    ]);
    const wires = pins.flatMap((pin, i): [string, string][] => [
      [`board:${pin}`, `R${i}:1`],
      [`R${i}:2`, `L${i}:anode`],
      [`L${i}:cathode`, 'board:GND1'],
    ]);
    const v = find(build(PICO, parts, wires), 'gpio_total_overcurrent');
    expect(v).toHaveLength(1);
    expect(v[0].params.ma as number).toBeGreaterThan(50);
  });
  it('rail_overload: three OLEDs on the Uno 3V3 rail (limit 50 mA)', () => {
    const parts: PartSpec[] = [
      ['o1', 'ssd1306-128x64-i2c'],
      ['o2', 'ssd1306-128x64-i2c'],
      ['o3', 'ssd1306-128x64-i2c'],
    ];
    const wires = parts.flatMap(([id]): [string, string][] => [
      ['board:3V3', `${id}:VCC`],
      ['board:GND1', `${id}:GND`],
    ]);
    const v = find(build(UNO, parts, wires), 'rail_overload');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ severity: 'error', params: { pin: '3V3', limit: 50 } });
  });
  it('rail_overload warns above 80 % of the limit', () => {
    const parts: PartSpec[] = [
      ['o1', 'ssd1306-128x64-i2c'],
      ['d', 'dht22'],
    ];
    const wires: [string, string][] = [
      ['board:3V3', 'o1:VCC'],
      ['board:GND1', 'o1:GND'],
      ['board:3V3', 'd:VCC'],
      ['board:GND1', 'd:GND'],
    ];
    expect(find(build(UNO, parts, wires), 'rail_overload')).toHaveLength(0); // 21.5 mA из 50
    const tight = build(
      UNO,
      [...parts, ['o2', 'ssd1306-128x64-i2c']],
      [...wires, ['board:3V3', 'o2:VCC'], ['board:GND1', 'o2:GND']],
    );
    expect(find(tight, 'rail_overload')[0]?.severity).toBe('warning'); // 41.5 мА = 83 %
  });
  it('power_budget: ESP32 + loads over a 100 mA budget', () => {
    const p = build(
      ESP,
      [['o', 'ssd1306-128x64-i2c']],
      [
        ['board:3V3', 'o:VCC'],
        ['board:GND1', 'o:GND'],
      ],
      { power: { source: 'usb', voltage: 5, budgetMa: 90 } },
    );
    expect(find(p, 'power_budget')[0].severity).toBe('error');
  });
  it('servo from the 5 V pin: high_current_from_rail warning; on 3.3 V: supply voltage error', () => {
    const uno = build(
      UNO,
      [['s', 'servo-sg90']],
      [
        ['board:5V', 's:VCC'],
        ['board:GND1', 's:GND'],
        ['board:D9', 's:SIG'],
      ],
    );
    expect(find(uno, 'high_current_from_rail')[0].params).toMatchObject({ ma: 650, limit: 500 });
    const esp = build(
      ESP,
      [['s', 'servo-sg90']],
      [
        ['board:3V3', 's:VCC'],
        ['board:GND1', 's:GND'],
        ['board:GPIO18', 's:SIG'],
      ],
    );
    expect(find(esp, 'part_supply_voltage')[0].params).toMatchObject({ v: 3.3, min: 4.8 });
  });
});

describe('pins', () => {
  const led = (pin: string) =>
    build(
      ESP,
      [
        ['R1', 'resistor', '220'],
        ['led', 'led-5mm-red'],
      ],
      [
        [`board:${pin}`, 'R1:1'],
        ['R1:2', 'led:anode'],
        ['led:cathode', 'board:GND1'],
      ],
    );
  it('input-only pin cannot drive an LED but can read a button', () => {
    expect(rules(led('GPIO34'))).toContain('input_only_as_output');
    const btn = build(
      ESP,
      [['b', 'button-6mm']],
      [
        ['board:GPIO34', 'b:1'],
        ['b:2', 'board:GND1'],
      ],
    );
    expect(rules(btn)).not.toContain('input_only_as_output');
  });
  it('input-only pin cannot talk to a bidirectional DHT22 line', () => {
    const p = build(
      ESP,
      [
        ['d', 'dht22'],
        ['R', 'resistor', '4.7k'],
      ],
      [
        ['board:3V3', 'd:VCC'],
        ['board:GND1', 'd:GND'],
        ['board:GPIO35', 'd:DATA'],
        ['R:1', 'board:3V3'],
        ['R:2', 'd:DATA'],
      ],
    );
    expect(rules(p)).toContain('input_only_as_output');
  });
  it('strapping pins give a warning, normal pins do not', () => {
    expect(find(led('GPIO12'), 'strapping_pin_used')[0].severity).toBe('warning');
    expect(rules(led('GPIO18'))).not.toContain('strapping_pin_used');
  });
  it('flash / reserved pins are errors', () => {
    const base = getBoard(ESP)!;
    const board: BoardDef = {
      ...base,
      pins: base.pins.map((p) => (p.id === 'GPIO19' ? { ...p, flags: ['flash'] } : p)),
    };
    expect(find(led('GPIO19'), 'flash_pin_used', { board })[0].severity).toBe('error');
  });
  it('ADC2 pin + Wi-Fi + analog sensor is an error; ADC1 pin or no Wi-Fi is fine', () => {
    const pot = (pin: string, description: string) =>
      build(
        ESP,
        [['p', 'potentiometer-10k']],
        [
          ['board:3V3', 'p:3'],
          ['board:GND1', 'p:1'],
          [`board:${pin}`, 'p:wiper'],
        ],
        { description },
      );
    expect(rules(pot('GPIO25', 'sends the reading over WiFi to MQTT'))).toContain('adc2_wifi');
    expect(rules(pot('GPIO25', 'local display only'))).not.toContain('adc2_wifi');
    expect(rules(pot('GPIO34', 'sends the reading over WiFi'))).not.toContain('adc2_wifi');
  });
  it('function_mismatch: I²C on a fixed-function board vs a flexible one', () => {
    const oled = (board: string, sda: string, scl: string) =>
      build(
        board,
        [['o', 'ssd1306-128x64-i2c']],
        [
          [`board:${board === UNO ? '5V' : '3V3'}`, 'o:VCC'],
          ['board:GND1', 'o:GND'],
          [`board:${sda}`, 'o:SDA'],
          [`board:${scl}`, 'o:SCL'],
        ],
      );
    expect(find(oled(UNO, 'D2', 'D3'), 'function_mismatch')).toHaveLength(2);
    expect(rules(oled(UNO, 'A4', 'A5'))).not.toContain('function_mismatch');
    expect(rules(oled(ESP, 'GPIO5', 'GPIO18'))).not.toContain('function_mismatch'); // I²C можно на любые пины ESP32
  });
  it('function_mismatch: PWM servo on an Uno pin without PWM / an ESP32 input-only pin', () => {
    const servo = (board: string, pin: string) =>
      build(
        board,
        [['s', 'servo-sg90']],
        [
          [board === UNO ? 'board:5V' : 'board:VIN', 's:VCC'],
          ['board:GND1', 's:GND'],
          [`board:${pin}`, 's:SIG'],
        ],
      );
    expect(rules(servo(UNO, 'D4'))).toContain('function_mismatch');
    expect(rules(servo(UNO, 'D9'))).not.toContain('function_mismatch');
    expect(rules(servo(ESP, 'GPIO34'))).toContain('function_mismatch');
  });
});

describe('structure', () => {
  it('short_circuit: supply to ground, and two different supplies', () => {
    expect(rules(build(ESP, [], [['board:3V3', 'board:GND1']]))).toContain('short_circuit');
    expect(rules(build(ESP, [], [['board:3V3', 'board:VIN']]))).toContain('short_circuit');
    expect(rules(build(ESP, [], [['board:GND1', 'board:GND2']]))).not.toContain('short_circuit');
  });
  it('multiple_drivers: two GPIOs, or two sensor outputs, on one net', () => {
    expect(rules(build(ESP, [], [['board:GPIO18', 'board:GPIO19']]))).toContain('multiple_drivers');
    const two = build(
      ESP,
      [
        ['a', 'hc-sr04'],
        ['b', 'hc-sr04'],
      ],
      [['a:ECHO', 'b:ECHO']],
    );
    expect(rules(two)).toContain('multiple_drivers');
  });
  it('unconnected_required: missing GND or VCC on a module', () => {
    const noGnd = build(ESP, [['o', 'ssd1306-128x64-i2c']], [['board:3V3', 'o:VCC']]);
    expect(find(noGnd, 'unconnected_required')[0].params.pin).toBe('GND');
    const noVcc = build(ESP, [['o', 'ssd1306-128x64-i2c']], [['board:GND1', 'o:GND']]);
    expect(find(noVcc, 'unconnected_required')[0].params.pin).toBe('VCC');
  });
  it('part_supply_voltage: HC-SR04 needs 5 V, not 3.3 V', () => {
    const p = build(
      ESP,
      [['h', 'hc-sr04']],
      [
        ['board:3V3', 'h:VCC'],
        ['board:GND1', 'h:GND'],
      ],
    );
    expect(find(p, 'part_supply_voltage')[0].params).toMatchObject({ v: 3.3, min: 4.5 });
  });
  it('supply_out_of_range for a battery outside the board VIN range', () => {
    const p = build(UNO, [], [], { power: { source: 'battery', voltage: 3.0, budgetMa: 500 } });
    expect(rules(p)).toContain('supply_out_of_range');
    expect(
      rules(build(UNO, [], [], { power: { source: 'battery', voltage: 9, budgetMa: 500 } })),
    ).not.toContain('supply_out_of_range');
  });
  it('reports unknown boards, components, pins, and unverified parts', () => {
    expect(rules(build('nope', [], []))).toEqual(['unknown_board']);
    expect(rules(build(ESP, [['x', 'ghost']], [['board:3V3', 'x:1']]))).toContain(
      'unknown_component',
    );
    expect(rules(build(ESP, [['r', 'resistor', '1k']], [['board:3V3', 'r:9']]))).toContain(
      'unknown_pin',
    );
    const generic: ComponentDef = { ...getComponent('resistor')!, id: 'gen', verified: false };
    expect(
      rules(build(ESP, [['g', 'gen', '1k']], []), {
        getComponent: (id) => (id === 'gen' ? generic : getComponent(id)),
      }),
    ).toContain('unverified_component');
  });
});

describe('parts', () => {
  const led = (wires: [string, string][], parts: PartSpec[] = [['led', 'led-5mm-red']]) =>
    build(ESP, parts, wires);
  it('led_no_resistor: direct, and through a transistor without any resistor', () => {
    expect(
      rules(
        led([
          ['board:GPIO18', 'led:anode'],
          ['led:cathode', 'board:GND1'],
        ]),
      ),
    ).toContain('led_no_resistor');
    expect(
      rules(
        led([
          ['board:3V3', 'led:anode'],
          ['led:cathode', 'board:GND1'],
        ]),
      ),
    ).toContain('led_no_resistor');
  });
  it('a resistor on the cathode side also protects the LED', () => {
    const p = led(
      [
        ['board:3V3', 'led:anode'],
        ['led:cathode', 'R:1'],
        ['R:2', 'board:GND1'],
      ],
      [
        ['led', 'led-5mm-red'],
        ['R', 'resistor', '150'],
      ],
    );
    clean(p);
    const hot = led(
      [
        ['board:3V3', 'led:anode'],
        ['led:cathode', 'R:1'],
        ['R:2', 'board:GND1'],
      ],
      [
        ['led', 'led-5mm-red'],
        ['R', 'resistor', '22'],
      ],
    );
    expect(rules(hot)).toContain('led_overcurrent');
  });

  const lite: ComponentDef = {
    ...getComponent('dc-motor-130')!,
    id: 'motor-lite',
    params: { ...getComponent('dc-motor-130')!.params, runCurrentMa: 100 },
  };
  const withLite: ErcOptions = {
    getComponent: (id) => (id === 'motor-lite' ? lite : getComponent(id)),
  };
  const motor = (extra: [string, string][] = [], parts: PartSpec[] = []) =>
    build(
      ESP,
      [['m', 'motor-lite'], ['q', 'npn-2n2222'], ['Rb', 'resistor', '240'], ...parts],
      [
        ['board:VIN', 'm:M+'],
        ['m:M-', 'q:C'],
        ['q:E', 'board:GND1'],
        ['board:GPIO18', 'Rb:1'],
        ['Rb:2', 'q:B'],
        ...extra,
      ],
    );
  it('inductive_no_flyback, then fixed with a correctly oriented diode', () => {
    expect(rules(motor(), withLite)).toContain('inductive_no_flyback');
    const ok = motor(
      [
        ['d:cathode', 'm:M+'],
        ['d:anode', 'm:M-'],
      ],
      [['d', 'diode-1n4007']],
    );
    clean(ok, withLite);
    const reversed = motor(
      [
        ['d:anode', 'm:M+'],
        ['d:cathode', 'm:M-'],
      ],
      [['d', 'diode-1n4007']],
    );
    expect(rules(reversed, withLite)).toContain('flyback_diode_reversed');
  });
  it('inductive_direct_gpio: motor straight from a pin', () => {
    const p = build(
      ESP,
      [['m', 'dc-motor-130']],
      [
        ['board:GPIO18', 'm:M+'],
        ['m:M-', 'board:GND1'],
      ],
    );
    expect(rules(p)).toContain('inductive_direct_gpio');
  });
  it('transistor base: no resistor, too weak, and OK', () => {
    expect(rules(build(ESP, [['q', 'npn-2n2222']], [['board:GPIO18', 'q:B']]))).toContain(
      'base_no_resistor',
    );
    const bad = Project.parse({
      ...motor(
        [
          ['d:cathode', 'm:M+'],
          ['d:anode', 'm:M-'],
        ],
        [['d', 'diode-1n4007']],
      ),
      parts: [
        ...motor([], [['d', 'diode-1n4007']]).parts.map((p) =>
          p.instanceId === 'Rb' ? { ...p, value: '10k' } : p,
        ),
      ],
    });
    expect(find(bad, 'transistor_saturation', withLite)[0].severity).toBe('error');
  });
  it('MOSFET logic level: IRLZ44N is marginal on 3.3 V, fine on 5 V, fails when the threshold is too high', () => {
    const mos = (board: string, pin: string) =>
      build(
        board,
        [['q', 'mosfet-irlz44n']],
        [
          [`board:${pin}`, 'q:G'],
          ['q:S', 'board:GND1'],
        ],
      );
    expect(find(mos(ESP, 'GPIO18'), 'mosfet_logic_level')[0].severity).toBe('warning');
    expect(rules(mos(UNO, 'D9'))).not.toContain('mosfet_logic_level');
    const hard: ComponentDef = {
      ...getComponent('mosfet-irlz44n')!,
      id: 'hard',
      params: { ...getComponent('mosfet-irlz44n')!.params, vgsThMaxV: 4 },
    };
    const p = build(
      ESP,
      [['q', 'hard']],
      [
        ['board:GPIO18', 'q:G'],
        ['q:S', 'board:GND1'],
      ],
    );
    expect(
      find(p, 'mosfet_logic_level', {
        getComponent: (id) => (id === 'hard' ? hard : getComponent(id)),
      })[0].severity,
    ).toBe('error');
  });
  it('mains relay: danger notice, and an error until the project warns about it', () => {
    const wires: [string, string][] = [
      ['board:VIN', 'r:VCC'],
      ['board:GND1', 'r:GND'],
      ['board:GPIO18', 'r:IN'],
    ];
    const bare = build(ESP, [['r', 'relay-module-1ch']], wires);
    expect(find(bare, 'mains_warning')[0].severity).toBe('danger');
    expect(rules(bare)).toContain('missing_mains_warning');
    const warned = build(ESP, [['r', 'relay-module-1ch']], wires, {
      warnings: [{ level: 'danger', text: '220 V' }],
    });
    expect(rules(warned)).toContain('mains_warning');
    expect(rules(warned)).not.toContain('missing_mains_warning');
    expect(runErc(warned).ok).toBe(true);
  });
  it('DHT22 needs a 4.7–10 kΩ pull-up', () => {
    const dht = (value?: string) =>
      build(
        ESP,
        [['d', 'dht22'], ...(value ? ([['R', 'resistor', value]] as PartSpec[]) : [])],
        [
          ['board:3V3', 'd:VCC'],
          ['board:GND1', 'd:GND'],
          ['board:GPIO4', 'd:DATA'],
          ...(value
            ? ([
                ['R:1', 'board:3V3'],
                ['R:2', 'd:DATA'],
              ] as [string, string][])
            : []),
        ],
      );
    expect(rules(dht())).toContain('missing_pullup');
    expect(rules(dht('100'))).toContain('pullup_value');
    expect(rules(dht('4.7k'))).not.toContain('pullup_value');
    expect(rules(dht('4.7k'))).not.toContain('missing_pullup');
  });
  it('I²C: pull-ups, built-in pull-ups, and address conflicts', () => {
    const raw: ComponentDef = {
      ...getComponent('ssd1306-128x64-i2c')!,
      id: 'raw',
      params: { i2cAddress: '0x3C' },
    };
    const o: ErcOptions = { getComponent: (id) => (id === 'raw' ? raw : getComponent(id)) };
    const bus = (parts: PartSpec[], extra: [string, string][] = []) =>
      build(ESP, parts, [
        ...parts.flatMap(([id]): [string, string][] => [
          ['board:3V3', `${id}:VCC`],
          ['board:GND1', `${id}:GND`],
          ['board:GPIO21', `${id}:SDA`],
          ['board:GPIO22', `${id}:SCL`],
        ]),
        ...extra,
      ]);
    expect(find(bus([['a', 'raw']]), 'i2c_pullup_missing', o).length).toBe(2); // SDA и SCL
    const pulled = bus(
      [
        ['a', 'raw'],
        ['R1', 'resistor', '4.7k'],
        ['R2', 'resistor', '4.7k'],
      ],
      [
        ['R1:1', 'board:3V3'],
        ['R1:2', 'board:GPIO21'],
        ['R2:1', 'board:3V3'],
        ['R2:2', 'board:GPIO22'],
      ],
    );
    expect(find(pulled, 'i2c_pullup_missing', o)).toHaveLength(0);
    expect(rules(bus([['a', 'ssd1306-128x64-i2c']]))).not.toContain('i2c_pullup_missing');
    expect(
      find(
        bus([
          ['a', 'ssd1306-128x64-i2c'],
          ['b', 'ssd1306-128x64-i2c'],
        ]),
        'i2c_address_conflict',
      )[0].params.addr,
    ).toBe('0x3C');
  });
});

describe('values and calculations', () => {
  const r = (value?: string) => build(ESP, [['R1', 'resistor', value]], []);
  it('checks resistor values', () => {
    expect(rules(r())).toContain('invalid_value');
    expect(rules(r('abc'))).toContain('invalid_value');
    expect(find(r('215'), 'nonstandard_value')[0].params.near).toBe(220);
    expect(rules(r('4.7k'))).toEqual([]);
  });
  const calc = (extra: Record<string, unknown>) =>
    build(ESP, [], [], {
      calculations: [
        {
          id: 'led-resistor',
          title: 't',
          formula: 'f',
          inputs: { vccV: 5, vfV: 2, ifMa: 20 },
          result: 150,
          unit: 'Ω',
          explanation: 'e',
          ...extra,
        },
      ],
    });
  it('accepts matching calculations in several unit spellings and roundings', () => {
    clean(calc({}));
    clean(calc({ unit: 'Ом' }));
    clean(calc({ unit: 'kΩ', result: 0.15 }));
    clean(calc({ inputs: { vccV: 3.3, vfV: 2, ifMa: 6 }, result: 217 })); // точное значение
    clean(calc({ inputs: { vccV: 3.3, vfV: 2, ifMa: 6 }, result: 220 })); // стандартное
    clean(calc({ inputs: { vccV: 3.3, vfV: 2, ifMa: 6 }, result: 200 })); // нижний стандартный номинал тоже допустим
  });
  it('flags AI mistakes', () => {
    const bad = find(calc({ result: 330 }), 'calc_mismatch');
    expect(bad).toHaveLength(1);
    expect(bad[0].params.expected).toBe('150 Ω');
    expect(rules(calc({ unit: 'V' }))).toContain('calc_mismatch');
    expect(rules(calc({ inputs: { vccV: 1, vfV: 2, ifMa: 20 } }))).toContain('calc_invalid');
    expect(rules(calc({ id: 'custom-note' }))).toEqual([]);
  });
});

describe('reporting', () => {
  it('sorts by severity, counts, and only errors block', () => {
    const p = build(
      ESP,
      [
        ['R1', 'resistor', '215'],
        ['r', 'relay-module-1ch'],
      ],
      [
        ['board:VIN', 'r:VCC'],
        ['board:GND1', 'r:GND'],
        ['board:GPIO12', 'r:IN'],
      ],
    );
    const rep = runErc(p);
    expect(rep.violations[0].severity).toBe('danger');
    expect(rep.counts.warning).toBeGreaterThan(0);
    expect(rep.ok).toBe(false); // missing_mains_warning
    expect(
      violationsForAi(rep).every((s) => /^\[(missing_mains_warning|[a-z_0-9]+)\]/.test(s)),
    ).toBe(true);
    expect(violationsForAi(rep).some((s) => s.includes('nonstandard_value'))).toBe(false);
  });
  it('has a message for every rule in ru / uk / en', () => {
    for (const rule of RULES)
      for (const dict of [ru, uk, en] as Record<string, string>[])
        expect(dict[`erc.${rule}`], rule).toBeTruthy();
  });
  it('formats messages without leftover placeholders', () => {
    const rep = runErc(hc([['hc:ECHO', 'board:GPIO18']]));
    for (const loc of ['ru', 'uk', 'en'] as const)
      for (const v of rep.violations) expect(formatViolation(v, loc)).not.toMatch(/\{\w+\}/);
    expect(
      formatViolation(
        rep.violations.find((v) => v.rule === 'level_overvoltage')!,
        'en',
      ),
    ).toContain('5 V');
  });
});
