/** Уравнения полупроводниковых моделей. Токи — в амперах, напряжения — в вольтах. */

export const VT = 0.025852; // тепловое напряжение при 300 К
const EXP_LIMIT = 40;
const E_LIMIT = Math.exp(EXP_LIMIT);

/** exp(x) с линейным продолжением после x = 40: исключает переполнение, производная остаётся непрерывной. */
export function expLim(x: number): { f: number; d: number } {
  if (x <= EXP_LIMIT) {
    const e = Math.exp(x);
    return { f: e, d: e };
  }
  return { f: E_LIMIT * (1 + x - EXP_LIMIT), d: E_LIMIT };
}

export interface DiodeParams {
  /** Ток насыщения, А. */
  is: number;
  /** Коэффициент неидеальности. */
  n: number;
}

/** Параметры диода по точке вольт-амперной характеристики: падение vf при токе iRefA. */
export function diodeFromPoint(vf: number, iRefA: number, n: number): DiodeParams {
  return { is: iRefA / (Math.exp(vf / (n * VT)) - 1), n };
}

export function diodeEval(v: number, p: DiodeParams): { i: number; g: number } {
  const { f, d } = expLim(v / (p.n * VT));
  return { i: p.is * (f - 1), g: (p.is * d) / (p.n * VT) };
}

export interface BjtParams {
  is: number;
  /** Прямой и обратный коэффициенты усиления. */
  bf: number;
  br: number;
}

/**
 * NPN по модели Эберса–Молла. Токи, втекающие в C, B, E, и якобиан по (Vc, Vb, Ve).
 * Ic = αF·IF − IR; Ib = (1−αF)·IF + (1−αR)·IR; Ie = −(Ic + Ib).
 */
export function bjtEval(
  vc: number,
  vb: number,
  ve: number,
  p: BjtParams,
): { i: [number, number, number]; J: number[][] } {
  const aF = p.bf / (1 + p.bf);
  const aR = p.br / (1 + p.br);
  const be = diodeEval(vb - ve, { is: p.is, n: 1 });
  const bc = diodeEval(vb - vc, { is: p.is, n: 1 });
  const ic = aF * be.i - bc.i;
  const ib = (1 - aF) * be.i + (1 - aR) * bc.i;
  // производные по Vbe (a) и Vbc (b)
  const dIc = { be: aF * be.g, bc: -bc.g };
  const dIb = { be: (1 - aF) * be.g, bc: (1 - aR) * bc.g };
  // Vbe = Vb − Ve, Vbc = Vb − Vc  →  d/dVc = −d/dVbc, d/dVb = d/dVbe + d/dVbc, d/dVe = −d/dVbe
  const row = (d: { be: number; bc: number }) => [-d.bc, d.be + d.bc, -d.be];
  const rc = row(dIc);
  const rb = row(dIb);
  const re = rc.map((x, k) => -(x + rb[k]));
  return { i: [ic, ib, -(ic + ib)], J: [rc, rb, re] };
}

export interface NmosParams {
  /** Транспроводимость, А/В². */
  k: number;
  vth: number;
  /** Модуляция длины канала, 1/В. */
  lambda: number;
}

/** Параметры по сопротивлению открытого канала rds при Vgs = vgsRef (малое Vds: Rds = 1 / (K·(Vgs − Vth))). */
export function nmosFromRds(rdsOhm: number, vgsRef: number, vth: number): NmosParams {
  return { k: 1 / (rdsOhm * Math.max(vgsRef - vth, 0.1)), vth, lambda: 0.01 };
}

const G_OFF = 1e-12;

/** Ток стока Id (от D к S) и производные по Vgs, Vds при Vds ≥ 0. */
function nmosCore(
  vgs: number,
  vds: number,
  p: NmosParams,
): { id: number; gm: number; gds: number } {
  const vov = vgs - p.vth;
  if (vov <= 0) return { id: G_OFF * vds, gm: 0, gds: G_OFF };
  const clm = 1 + p.lambda * vds;
  if (vds < vov) {
    const base = vov * vds - (vds * vds) / 2;
    return {
      id: p.k * base * clm + G_OFF * vds,
      gm: p.k * vds * clm,
      gds: p.k * ((vov - vds) * clm + base * p.lambda) + G_OFF,
    };
  }
  const base = (p.k / 2) * vov * vov;
  return { id: base * clm + G_OFF * vds, gm: p.k * vov * clm, gds: base * p.lambda + G_OFF };
}

/** N-MOSFET. Токи, втекающие в D, G, S, и якобиан по (Vd, Vg, Vs). Сток и исток симметричны. */
export function nmosEval(
  vd: number,
  vg: number,
  vs: number,
  p: NmosParams,
): { i: [number, number, number]; J: number[][] } {
  const swapped = vd < vs;
  const [vdn, vsn] = swapped ? [vs, vd] : [vd, vs];
  const { id, gm, gds } = nmosCore(vg - vsn, vdn - vsn, p);
  // Нормальная ориентация: в D втекает Id, в S — −Id; производные Id по (Vd, Vg, Vs) = [gds, gm, −gm−gds].
  const rowN = [gds, gm, -gm - gds];
  // Если Vd < Vs, истоком служит вывод D: в D втекает −Id, а производные берутся с переставленными Vd↔Vs и обратным знаком.
  const dRow = swapped ? [-rowN[2], -rowN[1], -rowN[0]] : rowN;
  const iD = swapped ? -id : id;
  return { i: [iD, 0, -iD], J: [dRow, [0, 0, 0], dRow.map((x) => -x)] };
}
