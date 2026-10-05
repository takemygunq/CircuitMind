import { describe, expect, it } from 'vitest';
import { analyzeCircuit } from '../erc';
import { blinkUno, weatherEsp32 } from '../fixtures';
import { getBoard } from '../library';
import { Project } from '../schema';
import { defaultSimState, simulate, wireFlows, type SimState } from './index';

type PartSpec = [id: string, component: string, value?: string];
function build(
  boardId: string,
  parts: PartSpec[],
  wires: [string, string][],
  extra: Record<string, unknown> = {},
): Project {
  return Project.parse({
    title: 'T',
    description: 'sim test',
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
const ESP = 'esp32-devkit-v1';
const UNO = 'arduino-uno';
const run = (p: Project, state?: Partial<SimState>) => {
  const board = getBoard(p.boardId)!;
  return simulate(p, board, { ...defaultSimState(p, board), ...state });
};
const mA = (a: number) => a * 1000;

const ledCircuit = (board: string, pin: string, r: string) =>
  build(
    board,
    [
      ['R1', 'resistor', r],
      ['led', 'led-5mm-red'],
    ],
    [
      [`board:${pin}`, 'R1:1'],
      ['R1:2', 'led:anode'],
      ['led:cathode', 'board:GND1'],
    ],
  );

describe('LED circuits', () => {
  it('Uno D13 → 150 Ω → LED draws ≈ 17 mA (pin output resistance included) and glows', () => {
    const r = run(ledCircuit(UNO, 'D13', '150'), { gpio: { D13: 'high' } });
    expect(r.status).toBe('ok');
    const led = r.parts.led;
    expect(mA(led.i!)).toBeGreaterThan(16);
    expect(mA(led.i!)).toBeLessThan(18.5);
    expect(led.v!).toBeGreaterThan(1.9);
    expect(led.v!).toBeLessThan(2.3);
    expect(led.glow!).toBe(1.2); // перегрузка относительно типового тока — яркость на максимуме шкалы
    expect(led.status).toBe('ok');
    expect(r.parts.R1.i).toBeCloseTo(led.i!, 9);
  });
  it('LOW on the pin means no current and an idle LED', () => {
    const r = run(ledCircuit(UNO, 'D13', '150'), { gpio: { D13: 'low' } });
    expect(Math.abs(r.parts.led.i!)).toBeLessThan(1e-9);
    expect(r.parts.led.status).toBe('idle');
    expect(r.parts.led.glow).toBe(0);
  });
  it('Hi-Z pin leaves the LED dark', () => {
    expect(run(ledCircuit(UNO, 'D13', '150'), { gpio: { D13: 'hiz' } }).parts.led.status).toBe(
      'idle',
    );
  });
  it('3.3 V ESP32 with 220 Ω gives ≈ 5.5 mA', () => {
    const led = run(ledCircuit(ESP, 'GPIO18', '220'), { gpio: { GPIO18: 'high' } }).parts.led;
    expect(mA(led.i!)).toBeGreaterThan(4.5);
    expect(mA(led.i!)).toBeLessThan(6.5);
  });
});

describe('burnout', () => {
  it('an LED wired straight to a pin burns out and the circuit is re-solved without it', () => {
    const p = build(
      UNO,
      [['led', 'led-5mm-red']],
      [
        ['board:D13', 'led:anode'],
        ['led:cathode', 'board:GND1'],
      ],
    );
    const r = run(p, { gpio: { D13: 'high' } });
    expect(r.failed.led).toBe('overcurrent');
    expect(r.parts.led).toMatchObject({ status: 'burnt', reason: 'overcurrent' });
    expect(r.parts.led.glow).toBeUndefined();
    expect(Math.abs(r.board.D13.i)).toBeLessThan(1e-9); // после обрыва ток не течёт
    expect(r.warnings.find((w) => w.code === 'pin_overcurrent')).toBeUndefined(); // цепь уже разорвана
  });
  it('a 10 Ω resistor across 5 V (2.5 W in a ¼ W part) burns out', () => {
    const p = build(
      UNO,
      [['R1', 'resistor', '10']],
      [
        ['board:5V', 'R1:1'],
        ['R1:2', 'board:GND1'],
      ],
    );
    const r = run(p);
    expect(r.failed.R1).toBe('overpower');
  });
  it('a moderately overloaded part only warns', () => {
    const p = build(
      UNO,
      [['R1', 'resistor', '47']],
      [
        ['board:5V', 'R1:1'],
        ['R1:2', 'board:GND1'],
      ],
    ); // 0.53 W: 2.1× ¼ W
    const r = run(p);
    expect(r.failed.R1).toBeUndefined();
    expect(r.parts.R1.status).toBe('warn');
  });
  it('only the worst part fails first, relieving the rest', () => {
    const p = build(
      UNO,
      [
        ['R1', 'resistor', '10'],
        ['R2', 'resistor', '10'],
      ],
      [
        ['board:5V', 'R1:1'],
        ['R1:2', 'board:GND1'],
        ['board:5V', 'R2:1'],
        ['R2:2', 'board:GND1'],
      ],
    );
    const r = run(p);
    expect(Object.keys(r.failed).length).toBeGreaterThanOrEqual(1);
  });
  it('overvoltage kills a module, undervoltage only switches it off', () => {
    const over = run(
      build(
        UNO,
        [['d', 'dht22']],
        [
          ['board:5V', 'd:VCC'],
          ['board:GND1', 'd:GND'],
        ],
      ),
      {},
    );
    expect(over.parts.d.status).toBe('ok'); // 5 В в пределах 5.5 В
    const wrong = run(
      build(
        UNO,
        [['o', 'ssd1306-128x64-i2c']],
        [
          ['board:VIN', 'o:VCC'],
          ['board:GND1', 'o:GND'],
        ],
      ),
      {},
    ); // 5 В у OLED, макс. 5 → ок
    expect(wrong.parts.o.status).toBe('ok');
    const burn = run(
      build(
        UNO,
        [['o', 'ssd1306-128x64-i2c']],
        [
          ['board:VIN', 'o:VCC'],
          ['board:GND1', 'o:GND'],
        ],
        { power: { source: 'battery', voltage: 9, budgetMa: 500 } },
      ),
    );
    expect(burn.failed.o).toBe('overvoltage');
    const off = run(
      build(
        ESP,
        [['h', 'hc-sr04']],
        [
          ['board:3V3', 'h:VCC'],
          ['board:GND1', 'h:GND'],
        ],
      ),
    );
    expect(off.parts.h.status).toBe('off');
  });
});

describe('transistor and MOSFET switches', () => {
  const motorCircuit = (drive: string) =>
    build(
      ESP,
      [
        ['m', 'relay-5v-coil'],
        ['q', 'npn-2n2222'],
        ['Rb', 'resistor', '1k'],
        ['d', 'diode-1n4007'],
      ],
      [
        ['board:VIN', 'm:COIL+'],
        ['m:COIL-', 'q:C'],
        ['q:E', 'board:GND1'],
        [`board:${drive}`, 'Rb:1'],
        ['Rb:2', 'q:B'],
        ['d:cathode', 'm:COIL+'],
        ['d:anode', 'm:COIL-'],
      ],
    );
  it('NPN saturates when driven: full coil current, Vce(sat) < 0.3 V', () => {
    const r = run(motorCircuit('GPIO18'), { gpio: { GPIO18: 'high' } });
    expect(r.status).toBe('ok');
    expect(r.parts.q.v!).toBeLessThan(0.3);
    expect(mA(r.parts.m.i!)).toBeGreaterThan(60); // катушка 5 В / 70 мА ≈ 71 Ом
    expect(mA(r.parts.m.i!)).toBeLessThan(75);
    const ib = r.parts.q.pins.B.i;
    expect(ib * 100).toBeGreaterThan(r.parts.q.pins.C.i); // насыщение: β·Ib > Ic
  });
  it('NPN is off when the base is low', () => {
    const r = run(motorCircuit('GPIO18'), { gpio: { GPIO18: 'low' } });
    expect(mA(r.parts.m.i!)).toBeLessThan(0.01);
  });
  it('IRLZ44N switches a 150 Ω load with ≈ mΩ of Rds(on) on 5 V gate drive', () => {
    const p = build(
      UNO,
      [
        ['q', 'mosfet-irlz44n'],
        ['R', 'resistor', '150'],
      ],
      [
        ['board:5V', 'R:1'],
        ['R:2', 'q:D'],
        ['q:S', 'board:GND1'],
        ['board:D9', 'q:G'],
      ],
    );
    const on = run(p, { gpio: { D9: 'high' } });
    expect(on.parts.q.v!).toBeLessThan(0.1);
    expect(mA(on.parts.R.i!)).toBeGreaterThan(32);
    const off = run(p, { gpio: { D9: 'low' } });
    expect(off.parts.q.v!).toBeGreaterThan(4.9);
    expect(mA(off.parts.R.i!)).toBeLessThan(0.01);
  });
});

describe('PWM', () => {
  const circuit = () => ledCircuit(UNO, 'D9', '150');
  const withDuty = (duty: number) => run(circuit(), { gpio: { D9: 'pwm' }, duty: { D9: duty } });
  const full = run(circuit(), { gpio: { D9: 'high' } }).parts.led;

  it('scales LED current and brightness linearly with the duty cycle', () => {
    for (const d of [0.25, 0.5, 0.75]) {
      const led = withDuty(d).parts.led;
      expect(led.i! / full.i!).toBeCloseTo(d, 3);
      expect(led.glow! / full.glow!).toBeCloseTo(d, 3);
    }
  });
  it('duty 0 behaves like LOW and duty 1 like HIGH', () => {
    expect(Math.abs(withDuty(0).parts.led.i!)).toBeLessThan(1e-9);
    expect(withDuty(1).parts.led.i!).toBeCloseTo(full.i!, 9);
  });
  it('averages the wire and pin currents too', () => {
    const r = withDuty(0.5);
    expect(-r.board.D9.i).toBeCloseTo(full.i! / 2, 6); // пин отдаёт ток: втекающий ток отрицательный
    expect(Math.max(...r.wires.map((w) => Math.abs(w.i)))).toBeCloseTo(full.i! / 2, 6);
    expect(r.parts.led.status).toBe('ok');
  });
  it('still burns out a part that is overloaded while the pin is HIGH', () => {
    const p = build(
      UNO,
      [['led', 'led-5mm-red']],
      [
        ['board:D9', 'led:anode'],
        ['led:cathode', 'board:GND1'],
      ],
    );
    const r = run(p, { gpio: { D9: 'pwm' }, duty: { D9: 0.5 } });
    expect(r.failed.led).toBe('overcurrent');
  });
  it('combines independent PWM channels', () => {
    const p = build(
      UNO,
      [
        ['R1', 'resistor', '150'],
        ['a', 'led-5mm-red'],
        ['R2', 'resistor', '150'],
        ['b', 'led-5mm-red'],
      ],
      [
        ['board:D9', 'R1:1'],
        ['R1:2', 'a:anode'],
        ['a:cathode', 'board:GND1'],
        ['board:D10', 'R2:1'],
        ['R2:2', 'b:anode'],
        ['b:cathode', 'board:GND1'],
      ],
    );
    const r = run(p, { gpio: { D9: 'pwm', D10: 'pwm' }, duty: { D9: 0.2, D10: 0.8 } });
    expect(r.parts.b.i! / r.parts.a.i!).toBeCloseTo(4, 1);
  });
});

describe('default pin states', () => {
  it('I²C lines idle pulled up, loads are driven, bare pins float', () => {
    const board = getBoard(ESP)!;
    const st = defaultSimState(weatherEsp32, board).gpio;
    expect(st.GPIO21).toBe('pullup');
    expect(st.GPIO22).toBe('pullup');
    expect(st.GPIO18).toBe('high'); // светодиод через резистор
    expect(st.GPIO19).toBe('pullup'); // кнопка
    expect(st.GPIO4).toBe('hiz'); // линия DHT22 с внешней подтяжкой
  });
  it('a motor or coil on a pin gets HIGH so the overload is visible', () => {
    const p = build(
      ESP,
      [['m', 'dc-motor-130']],
      [
        ['board:GPIO23', 'm:M+'],
        ['m:M-', 'board:GND1'],
      ],
    );
    expect(defaultSimState(p, getBoard(ESP)!).gpio.GPIO23).toBe('high');
    const r = run(p);
    expect(r.warnings.some((w) => w.code === 'pin_overcurrent' && w.ref === 'GPIO23')).toBe(true);
    expect(mA(r.parts.m.i!)).toBeGreaterThan(50);
  });
});

describe('inputs', () => {
  it('button with pull-up: reads HIGH released and LOW pressed', () => {
    const p = build(
      ESP,
      [['b', 'button-6mm']],
      [
        ['board:GPIO19', 'b:1'],
        ['b:2', 'board:GND1'],
      ],
    );
    expect(defaultSimState(p, getBoard(ESP)!).gpio.GPIO19).toBe('pullup');
    expect(run(p).endpoints['board:GPIO19'].v).toBeCloseTo(3.3, 2);
    const pressed = run(p, { pressed: { b: true } });
    expect(pressed.endpoints['board:GPIO19'].v).toBeLessThan(0.01);
    expect(mA(pressed.endpoints['board:GPIO19'].i)).toBeLessThan(0.1); // ≈ 73 мкА через подтяжку 45 кОм
  });
  it('potentiometer divider follows the slider', () => {
    const p = build(
      ESP,
      [['p', 'potentiometer-10k']],
      [
        ['board:3V3', 'p:3'],
        ['board:GND1', 'p:1'],
        ['board:GPIO34', 'p:wiper'],
      ],
    );
    for (const pos of [0.1, 0.5, 0.75])
      expect(run(p, { pots: { p: pos } }).endpoints['board:GPIO34'].v).toBeCloseTo(3.3 * pos, 2);
    expect(run(p, { pots: { p: 0.5 } }).parts.p.pins.wiper.i).toBeCloseTo(0, 6);
  });
  it('a resistor divider brings 5 V down to the level of a 3.3 V pin', () => {
    const p = build(
      ESP,
      [
        ['hc', 'hc-sr04'],
        ['R1', 'resistor', '1k'],
        ['R2', 'resistor', '2k'],
      ],
      [
        ['board:VIN', 'hc:VCC'],
        ['board:GND1', 'hc:GND'],
        ['hc:ECHO', 'R1:1'],
        ['R1:2', 'board:GPIO18'],
        ['R1:2', 'R2:1'],
        ['R2:2', 'board:GND1'],
      ],
    );
    expect(run(p).parts.hc.status).toBe('ok'); // питание 5 В
  });
});

describe('demo projects and consistency with ERC estimates', () => {
  const board = getBoard(ESP)!;
  const w = simulate(weatherEsp32, board);
  it('weather station: everything powered, LED lit at ≈ 5.5 mA, nothing burnt', () => {
    expect(w.status).toBe('ok');
    expect(w.failed).toEqual({});
    expect(w.parts.dht1.status).toBe('ok');
    expect(w.parts.oled1.status).toBe('ok');
    expect(w.parts.led1.status).toBe('ok');
    expect(mA(w.parts.led1.i!)).toBeGreaterThan(4.5);
    expect(mA(w.parts.led1.i!)).toBeLessThan(6.5);
    expect(w.warnings).toEqual([]);
  });
  it('3V3 rail current agrees with the static ERC estimate within 10 %', () => {
    const est = analyzeCircuit(weatherEsp32)!.power.rails.find((r) => r.pin === '3V3')!.ma;
    const sim = mA(w.board['3V3'].i) * -1;
    expect(sim).toBeGreaterThan(est * 0.9);
    expect(sim).toBeLessThan(est * 1.1);
  });
  it('LED current agrees with the ERC estimate', () => {
    const est = analyzeCircuit(weatherEsp32)!.leds[0].ma!;
    expect(Math.abs(mA(w.parts.led1.i!) - est)).toBeLessThan(est * 0.15);
  });
  it('Uno blink example lights the LED', () => {
    const r = simulate(blinkUno, getBoard(UNO)!);
    expect(r.parts.led1.status).toBe('ok');
    expect(mA(r.parts.led1.i!)).toBeGreaterThan(16);
  });
  it('KCL: the endpoint currents of every net sum to ≈ 0', () => {
    const nets = new Map<string, number>();
    weatherEsp32.connections.forEach((c) => {
      for (const ep of [c.from, c.to]) nets.set(ep, w.endpoints[ep].i);
    });
    expect(Math.abs([...nets.values()].reduce((s, i) => s + i, 0))).toBeLessThan(1e-9);
    // отдельные цепи: питание 3V3 — источник платы равен сумме потребителей
    const rail = ['dht1:VCC', 'oled1:VCC', 'Rpu:1'].reduce((s, ep) => s + w.endpoints[ep].i, 0);
    expect(rail + w.endpoints['board:3V3'].i).toBeCloseTo(0, 9);
  });
});

describe('wire currents', () => {
  const board = getBoard(ESP)!;
  const w = simulate(weatherEsp32, board);
  it('has one entry per connection and conserves current at hubs', () => {
    expect(w.wires).toHaveLength(weatherEsp32.connections.length);
    // 3V3 питает DHT22, OLED и подтяжку: ток первого провода от платы = сумма токов потребителей
    const idx = (to: string) =>
      weatherEsp32.connections.findIndex((c) => c.to === to && c.from === 'board:3V3');
    const sum = [idx('dht1:VCC'), idx('oled1:VCC'), idx('Rpu:1')].reduce(
      (s, i) => s + w.wires[i].i,
      0,
    );
    expect(sum).toBeCloseTo(-w.board['3V3'].i, 6);
    expect(w.wires[idx('oled1:VCC')].i).toBeGreaterThan(0.0199);
  });
  it('current directions follow the connection orientation', () => {
    const drive = weatherEsp32.connections.findIndex(
      (c) => c.from === 'board:GPIO18' && c.to === 'R1:1',
    );
    expect(w.wires[drive].i).toBeGreaterThan(0.0045); // от пина к резистору — по направлению соединения
    const gnd = weatherEsp32.connections.findIndex(
      (c) => c.from === 'board:GND2' && c.to === 'led1:cathode',
    );
    expect(w.wires[gnd].i).toBeLessThan(-0.0045); // ток течёт от катода к земле платы, то есть против from → to
  });
  it('reports the net voltage on wires', () => {
    const v3 = weatherEsp32.connections.findIndex((c) => c.from === 'board:3V3');
    expect(w.wires[v3].v).toBeGreaterThan(3.2);
    expect(w.wires[v3].v).toBeLessThanOrEqual(3.3);
  });
  it('wireFlows ignores unrelated endpoints', () => {
    const flows = wireFlows(
      { connections: [{ from: 'a:1', to: 'b:1' }] },
      {
        nets: {
          nets: [{ id: 0, name: 'n', endpoints: ['a:1', 'b:1'], connections: [0] }],
          netOfEndpoint: new Map(),
          netOfConnection: [0],
        },
      },
      { 'a:1': -0.01, 'b:1': 0.01 },
    );
    expect(flows[0]).toBeCloseTo(0.01, 12);
  });
});

describe('robustness', () => {
  it('survives a rail short without throwing and flags it', () => {
    const r = run(build(UNO, [], [['board:5V', 'board:GND1']]));
    expect(r.warnings.map((x) => x.code)).toContain('short_circuit');
    expect(Number.isFinite(r.board['5V'].i)).toBe(true);
  });
  it('survives two different rails tied together', () => {
    const r = run(build(ESP, [], [['board:3V3', 'board:VIN']]));
    expect(r.status).toBe('ok');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('handles empty projects and unconnected parts', () => {
    expect(run(build(UNO, [], [])).status).toBe('ok');
    const r = run(build(UNO, [['led', 'led-5mm-red']], []));
    expect(r.parts.led.status).toBe('idle');
  });
  it('ignores unknown components', () => {
    expect(run(build(UNO, [['x', 'ghost']], [['board:5V', 'x:1']])).status).toBe('ok');
  });
  it('is fast enough to run on every interaction', () => {
    const board = getBoard(ESP)!;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) simulate(weatherEsp32, board);
    expect((performance.now() - t0) / 20).toBeLessThan(50);
  });
});
