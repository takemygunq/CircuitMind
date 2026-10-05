import { describe, expect, it } from 'vitest';
import {
  CalcError,
  calcTypeFromId,
  calculate,
  ceilStandard,
  floorStandard,
  isStandard,
  nearestStandard,
  toProjectCalculation,
} from './index';

describe('E series', () => {
  it('rounds to the nearest E12 / E24 value', () => {
    expect(nearestStandard(217, 'E24')).toBe(220);
    expect(nearestStandard(4800, 'E12')).toBe(4700);
    expect(nearestStandard(0.52, 'E24')).toBe(0.51);
    expect(nearestStandard(1_000_000, 'E12')).toBe(1_000_000);
    expect(nearestStandard(99_999, 'E24')).toBe(100_000);
  });
  it('ceil never goes below and floor never above', () => {
    for (const v of [101, 150, 151, 217, 330.1, 999, 1001, 9100, 9101]) {
      expect(ceilStandard(v, 'E24')).toBeGreaterThanOrEqual(v);
      expect(floorStandard(v, 'E24')).toBeLessThanOrEqual(v);
    }
    expect(ceilStandard(150, 'E24')).toBe(150);
    expect(ceilStandard(151, 'E24')).toBe(160);
    expect(floorStandard(159, 'E24')).toBe(150);
    expect(ceilStandard(9101, 'E24')).toBe(10_000);
    expect(floorStandard(99, 'E24')).toBe(91);
  });
  it('recognises series membership', () => {
    expect(isStandard(220)).toBe(true);
    expect(isStandard(4700, 'E12')).toBe(true);
    expect(isStandard(215)).toBe(false);
    expect(isStandard(510, 'E12')).toBe(false);
    expect(isStandard(510, 'E24')).toBe(true);
    expect(isStandard(0)).toBe(false);
  });
  it('rejects non-positive values', () => {
    expect(() => nearestStandard(0)).toThrow(RangeError);
    expect(() => ceilStandard(-5)).toThrow(RangeError);
  });
});

describe('led_resistor', () => {
  it('5 V, red LED 2 V, 20 mA → 150 Ω', () => {
    const r = calculate('led_resistor', { vccV: 5, vfV: 2, ifMa: 20 });
    expect(r.result).toBe(150);
    expect(r.extra.actualMa).toBe(20);
    expect(r.extra.exactOhm).toBe(150);
  });
  it('rounds up so the current stays below the target', () => {
    const r = calculate('led_resistor', { vccV: 3.3, vfV: 2, ifMa: 6 });
    expect(r.result).toBe(220);
    expect(r.extra.actualMa as number).toBeLessThanOrEqual(6);
  });
  it('rejects a supply lower than Vf', () => {
    expect(() => calculate('led_resistor', { vccV: 1.8, vfV: 2, ifMa: 5 })).toThrow(CalcError);
  });
  it('supports E12', () => {
    expect(calculate('led_resistor', { vccV: 3.3, vfV: 2, ifMa: 6, series: 12 }).result).toBe(220);
    expect(calculate('led_resistor', { vccV: 5, vfV: 2, ifMa: 18 }).result).toBe(180);
  });
});

describe('bjt_base_resistor', () => {
  it('drives 100 mA with forced beta 10 from 3.3 V', () => {
    const r = calculate('bjt_base_resistor', { vdriveV: 3.3, icMa: 100 });
    expect(r.extra.ibMa).toBe(10);
    expect(r.extra.exactOhm).toBe(260);
    expect(r.result).toBe(240); // вниз по E24: базового тока не меньше
    expect(r.status).toBe('ok');
  });
  it('uses the lower of forced beta and hFE min', () => {
    const r = calculate('bjt_base_resistor', { vdriveV: 5, icMa: 200, hfeMin: 5 });
    expect(r.extra.ibMa).toBe(40);
  });
  it('rejects drive below Vbe', () => {
    expect(() => calculate('bjt_base_resistor', { vdriveV: 0.5, icMa: 10 })).toThrow(CalcError);
  });
});

describe('voltage dividers', () => {
  it('computes Vout', () => {
    expect(calculate('voltage_divider', { vinV: 5, r1Ohm: 10000, r2Ohm: 20000 }).result).toBe(3.33);
  });
  it('designs a 5 V → 3.3 V divider with standard values', () => {
    const r = calculate('divider_design', { vinV: 5, voutV: 3.3, r2Ohm: 20000 });
    expect(r.extra.r2Ohm).toBe(20000);
    expect(r.result).toBe(10000);
    expect(Math.abs((r.extra.actualOutV as number) - 3.3)).toBeLessThan(0.1);
    expect(r.status).toBe('ok');
  });
  it('rejects Vout >= Vin', () => {
    expect(() => calculate('divider_design', { vinV: 3.3, voutV: 5 })).toThrow(CalcError);
  });
});

describe('i2c_pullup', () => {
  it('100 kHz, 100 pF, 3.3 V gives a feasible range and an E12 value inside it', () => {
    const r = calculate('i2c_pullup', { vccV: 3.3, busCapPf: 100, speedKhz: 100 });
    expect(r.extra.minOhm as number).toBeCloseTo(966.67, 0);
    expect(r.extra.maxOhm as number).toBeCloseTo(11802, -2);
    expect(r.result).toBeGreaterThanOrEqual(r.extra.minOhm as number);
    expect(r.result).toBeLessThanOrEqual(r.extra.maxOhm as number);
    expect(r.status).toBe('ok');
  });
  it('fails when the bus is too slow for the capacitance', () => {
    const r = calculate('i2c_pullup', { vccV: 5, busCapPf: 800, speedKhz: 1000 });
    expect(r.status).toBe('fail');
  });
});

describe('pull_resistor', () => {
  it('suggests at least 4.7 kΩ and limits current', () => {
    const r = calculate('pull_resistor', { vccV: 3.3 });
    expect(r.result).toBe(6800);
    expect(r.extra.currentMa as number).toBeLessThanOrEqual(0.5);
  });
});

describe('mosfet_logic_level', () => {
  it('IRLZ44N on 5 V is fine', () => {
    const r = calculate('mosfet_logic_level', {
      vgsDriveV: 5,
      vgsThMaxV: 2,
      rdsOnOhm: 0.022,
      rdsOnAtVgsV: 5,
      loadCurrentA: 3,
    });
    expect(r.status).toBe('ok');
    expect(r.extra.powerW).toBeCloseTo(0.198, 3);
  });
  it('is marginal on 3.3 V when Rds(on) is quoted at 5 V', () => {
    expect(
      calculate('mosfet_logic_level', { vgsDriveV: 3.3, vgsThMaxV: 2, rdsOnAtVgsV: 5 }).status,
    ).toBe('warn');
  });
  it('fails for a standard-gate MOSFET on 3.3 V', () => {
    expect(calculate('mosfet_logic_level', { vgsDriveV: 3.3, vgsThMaxV: 4 }).status).toBe('fail');
  });
});

describe('current_budget', () => {
  it('sums loads and checks headroom', () => {
    const r = calculate('current_budget', {
      sourceMa: 500,
      'load:oled': 20,
      'load:dht': 1.5,
      'load:esp32': 240,
    });
    expect(r.result).toBe(261.5);
    expect(r.status).toBe('ok');
    expect(calculate('current_budget', { sourceMa: 500, 'load:servo': 650 }).status).toBe('fail');
  });
  it('requires a source', () => {
    expect(() => calculate('current_budget', { 'load:a': 1 })).toThrow(CalcError);
  });
});

describe('battery_life', () => {
  it('derates capacity to 80 % by default', () => {
    const r = calculate('battery_life', { capacityMah: 2000, activeMa: 100 });
    expect(r.result).toBe(16);
  });
  it('accounts for deep sleep duty cycle', () => {
    const r = calculate('battery_life', {
      capacityMah: 2000,
      activeMa: 80,
      sleepMa: 0.01,
      duty: 0.01,
    });
    expect(r.extra.avgMa as number).toBeCloseTo(0.81, 2);
    expect(r.extra.days as number).toBeGreaterThan(80);
  });
});

describe('level_check', () => {
  it('flags 5 V into a 3.6 V-tolerant pin', () => {
    const r = calculate('level_check', { driverV: 5, receiverMaxV: 3.6, receiverVihMinV: 2.3 });
    expect(r.status).toBe('fail');
    expect(r.extra.verdict).toBe('too_high');
  });
  it('flags 3.3 V into a 5 V part needing 3.5 V', () => {
    expect(
      calculate('level_check', { driverV: 3.3, receiverMaxV: 5.3, receiverVihMinV: 3.5 }).extra
        .verdict,
    ).toBe('too_low');
  });
  it('accepts matching levels', () => {
    expect(
      calculate('level_check', { driverV: 3.3, receiverMaxV: 3.6, receiverVihMinV: 2.3 }).status,
    ).toBe('ok');
  });
});

describe('calculate()', () => {
  it('reports unknown types and unknown input keys', () => {
    expect(() => calculate('nope', {})).toThrow(/Unknown calculation type/);
    expect(() => calculate('led_resistor', { vccV: 5, vfV: 2, ifMa: 20, extra: 1 })).toThrow(
      CalcError,
    );
  });
  it('lists validation issues', () => {
    try {
      calculate('led_resistor', { vccV: -1, vfV: 2, ifMa: 20 });
      expect.unreachable();
    } catch (e) {
      expect((e as CalcError).issues[0]).toContain('vccV');
    }
  });
  it('maps result into a project calculation entry', () => {
    const c = toProjectCalculation(calculate('led_resistor', { vccV: 5, vfV: 2, ifMa: 20 }), {
      id: 'led-resistor:led1',
      title: 'R',
      explanation: 'x',
    });
    expect(c).toMatchObject({
      id: 'led-resistor:led1',
      result: 150,
      unit: 'Ω',
      inputs: { vccV: 5, vfV: 2, ifMa: 20 },
    });
  });
  it('derives the type from calculation ids', () => {
    expect(calcTypeFromId('led-resistor')).toBe('led_resistor');
    expect(calcTypeFromId('led_resistor:led1')).toBe('led_resistor');
    expect(calcTypeFromId('custom')).toBeUndefined();
  });
});
