import { describe, expect, it } from 'vitest';
import { resistor, solveDc, solveLinear, theveninToGround, type Element } from './mna';
import { bjtEval, diodeEval, diodeFromPoint, expLim, nmosEval, nmosFromRds } from './models';

describe('solveLinear', () => {
  it('solves a 3x3 system', () => {
    const x = solveLinear(
      [
        [2, 1, -1],
        [-3, -1, 2],
        [-2, 1, 2],
      ],
      [8, -11, -3],
    )!;
    expect(x.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([2, 3, -1]);
  });
  it('pivots on zero diagonal entries', () => {
    expect(
      solveLinear(
        [
          [0, 1],
          [1, 0],
        ],
        [3, 4],
      ),
    ).toEqual([4, 3]);
  });
  it('detects singular systems', () => {
    expect(
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull();
  });
});

describe('linear circuits', () => {
  it('voltage divider: 5 V, 10k / 20k', () => {
    // узлы: 0 земля, 1 вход, 2 середина
    const r = solveDc(3, [
      theveninToGround(1, 5, 0.001),
      resistor(1, 2, 10_000),
      resistor(2, 0, 20_000),
    ]);
    expect(r.converged).toBe(true);
    expect(r.v[2]).toBeCloseTo(3.3333, 3);
  });
  it('source internal resistance drops the voltage under load', () => {
    const r = solveDc(2, [theveninToGround(1, 5, 25), resistor(1, 0, 75)]);
    expect(r.v[1]).toBeCloseTo(3.75, 6);
  });
  it('parallel resistors and a Wheatstone-like bridge', () => {
    const r = solveDc(4, [
      theveninToGround(1, 10, 1e-3),
      resistor(1, 2, 100),
      resistor(1, 3, 200),
      resistor(2, 0, 200),
      resistor(3, 0, 400),
      resistor(2, 3, 1000),
    ]);
    // мост сбалансирован (100/200 = 200/400): ток через перемычку нулевой
    expect(r.v[2]).toBeCloseTo((10 * 200) / 300, 3);
    expect(r.v[3]).toBeCloseTo(r.v[2], 6);
  });
  it('keeps floating nodes finite thanks to gmin', () => {
    const r = solveDc(3, [theveninToGround(1, 5, 1), resistor(1, 0, 100)]);
    expect(r.converged).toBe(true);
    expect(Number.isFinite(r.v[2])).toBe(true);
    expect(Math.abs(r.v[2])).toBeLessThan(1e-6);
  });
  it('handles a circuit with only ground', () => {
    expect(solveDc(1, []).converged).toBe(true);
  });
});

describe('nonlinear elements', () => {
  const diode = (a: number, k: number, p: ReturnType<typeof diodeFromPoint>): Element => ({
    nodes: [a, k],
    eval: ([va, vk]) => {
      const { i, g } = diodeEval(va - vk, p);
      return {
        i: [i, -i],
        J: [
          [g, -g],
          [-g, g],
        ],
      };
    },
  });
  it('LED: 5 V, 330 Ω, Vf = 2 V @ 10 mA', () => {
    const led = diodeFromPoint(2, 0.01, 2);
    const r = solveDc(3, [theveninToGround(1, 5, 0.01), resistor(1, 2, 330), diode(2, 0, led)]);
    expect(r.converged).toBe(true);
    const i = (r.v[1] - r.v[2]) / 330;
    expect(i * 1000).toBeGreaterThan(8.5);
    expect(i * 1000).toBeLessThan(9.5);
    expect(r.v[2]).toBeGreaterThan(1.9);
    expect(r.v[2]).toBeLessThan(2.1);
  });
  it('diode blocks in reverse', () => {
    const d = diodeFromPoint(0.7, 0.01, 1.8);
    const r = solveDc(3, [theveninToGround(1, 5, 0.01), resistor(1, 2, 330), diode(0, 2, d)]);
    expect(Math.abs((r.v[1] - r.v[2]) / 330)).toBeLessThan(1e-6); // только ток утечки ≈ Is
  });
  it('converges from a 3.3 V source straight into an LED (no series resistor)', () => {
    const led = diodeFromPoint(2, 0.01, 2);
    const r = solveDc(2, [theveninToGround(1, 3.3, 25), diode(1, 0, led)]);
    expect(r.converged).toBe(true);
    expect(r.v[1]).toBeGreaterThan(2);
    expect(r.v[1]).toBeLessThan(2.5);
  });
});

describe('device models', () => {
  it('expLim is continuous and overflow-safe', () => {
    expect(Math.abs(expLim(40).f / expLim(40.0000001).f - 1)).toBeLessThan(1e-6);
    expect(Number.isFinite(expLim(1e6).f)).toBe(true);
    expect(expLim(1).f).toBeCloseTo(Math.E, 10);
  });
  it('diode passes the calibration point', () => {
    const p = diodeFromPoint(2, 0.01, 2);
    expect(diodeEval(2, p).i).toBeCloseTo(0.01, 6);
  });
  it('BJT: currents sum to zero and Ic ≈ β·Ib in the active region', () => {
    const p = { is: 1e-14, bf: 150, br: 2 };
    const r = bjtEval(5, 0.68, 0, p); // Vbe = 0.68, Vc = 5 → активная область
    expect(r.i[0] + r.i[1] + r.i[2]).toBeCloseTo(0, 12);
    expect(r.i[0] / r.i[1]).toBeCloseTo(150, 0);
    for (const row of r.J) expect(row.reduce((s, x) => s + x, 0)).toBeCloseTo(0, 9); // сдвиг всех потенциалов не меняет токи
  });
  it('BJT Jacobian matches finite differences', () => {
    const p = { is: 1e-14, bf: 100, br: 2 };
    const v = [0.4, 0.66, 0];
    const base = bjtEval(v[0], v[1], v[2], p);
    for (let k = 0; k < 3; k++) {
      const h = 1e-7;
      const w = [...v];
      w[k] += h;
      const up = bjtEval(w[0], w[1], w[2], p);
      for (let r = 0; r < 3; r++) expect(base.J[r][k]).toBeCloseTo((up.i[r] - base.i[r]) / h, 3);
    }
  });
  it('NMOS: off below threshold, triode when on, symmetric when D and S swap', () => {
    const p = nmosFromRds(0.022, 5, 1.5);
    expect(nmosEval(5, 0, 0, p).i[0]).toBeLessThan(1e-9);
    const on = nmosEval(0.1, 5, 0, p); // малое Vds
    expect(0.1 / on.i[0]).toBeCloseTo(0.022, 3); // Rds(on) из параметров
    const swapped = nmosEval(0, 5, 0.1, p);
    expect(swapped.i[0]).toBeCloseTo(-on.i[0], 9);
    expect(swapped.i[2]).toBeCloseTo(on.i[0], 9);
  });
  it('NMOS Jacobian matches finite differences in all regions', () => {
    const p = nmosFromRds(0.05, 5, 1.5);
    for (const v of [
      [3, 4, 0],
      [0.5, 4, 0],
      [0, 4, 0.5],
      [2, 1, 0],
      [1, 3.3, 0.2],
    ]) {
      const base = nmosEval(v[0], v[1], v[2], p);
      for (let k = 0; k < 3; k++) {
        const h = 1e-7;
        const w = [...v];
        w[k] += h;
        const up = nmosEval(w[0], w[1], w[2], p);
        for (let r = 0; r < 3; r++) expect(base.J[r][k]).toBeCloseTo((up.i[r] - base.i[r]) / h, 3);
      }
    }
  });
});
