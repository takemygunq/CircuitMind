import { ceilStandard, floorStandard, nearestStandard, type ESeries } from './e-series';

/** Чистые формулы. Единицы: В, мА, Ом, Вт, пФ, нс, мА·ч, часы — как в именах полей. */

export interface LedResistorInput {
  vccV: number;
  vfV: number;
  ifMa: number;
  series?: ESeries;
}
export function ledResistor({ vccV, vfV, ifMa, series = 'E24' }: LedResistorInput) {
  if (!(vccV > vfV))
    throw new RangeError('supply voltage must be higher than the LED forward voltage');
  if (!(ifMa > 0)) throw new RangeError('LED current must be positive');
  const exactOhm = ((vccV - vfV) / ifMa) * 1000;
  const standardOhm = ceilStandard(exactOhm, series); // округляем вверх: ток не превысит заданный
  const actualMa = ((vccV - vfV) / standardOhm) * 1000;
  const powerMw = (actualMa / 1000) ** 2 * standardOhm * 1000;
  return { exactOhm, standardOhm, actualMa, powerMw };
}

export interface BjtBaseInput {
  vdriveV: number;
  vbeV?: number;
  icMa: number;
  /** Коэффициент насыщения («форсированный бета»): 10 — классическая рекомендация для ключа. */
  forcedBeta?: number;
  hfeMin?: number;
  series?: ESeries;
}
export function bjtBaseResistor({
  vdriveV,
  vbeV = 0.7,
  icMa,
  forcedBeta = 10,
  hfeMin,
  series = 'E24',
}: BjtBaseInput) {
  if (!(vdriveV > vbeV)) throw new RangeError('drive voltage must be higher than Vbe');
  if (!(icMa > 0)) throw new RangeError('collector current must be positive');
  const beta = hfeMin !== undefined ? Math.min(forcedBeta, hfeMin) : forcedBeta;
  const ibMa = icMa / beta;
  const exactOhm = ((vdriveV - vbeV) / ibMa) * 1000;
  const standardOhm = floorStandard(exactOhm, series); // округляем вниз: базового тока достаточно
  const actualIbMa = ((vdriveV - vbeV) / standardOhm) * 1000;
  return {
    ibMa,
    exactOhm,
    standardOhm,
    actualIbMa,
    saturationMargin: (actualIbMa * (hfeMin ?? forcedBeta)) / icMa,
  };
}

export function dividerOut(vinV: number, r1Ohm: number, r2Ohm: number): number {
  if (!(r1Ohm > 0 && r2Ohm > 0)) throw new RangeError('resistances must be positive');
  return (vinV * r2Ohm) / (r1Ohm + r2Ohm);
}

export interface DividerDesignInput {
  vinV: number;
  voutV: number;
  r2Ohm?: number;
  series?: ESeries;
}
/** Подбор верхнего плеча R1 при заданном нижнем R2 (по умолчанию 10 кОм). */
export function dividerDesign({ vinV, voutV, r2Ohm = 10000, series = 'E24' }: DividerDesignInput) {
  if (!(vinV > voutV && voutV > 0)) throw new RangeError('need 0 < Vout < Vin');
  const r2 = nearestStandard(r2Ohm, series);
  const exactR1 = (r2 * (vinV - voutV)) / voutV;
  const r1 = nearestStandard(exactR1, series);
  const actualOutV = dividerOut(vinV, r1, r2);
  const currentMa = (vinV / (r1 + r2)) * 1000;
  return { r1Ohm: r1, r2Ohm: r2, exactR1Ohm: exactR1, actualOutV, currentMa };
}

export interface I2cPullupInput {
  vccV: number;
  busCapPf: number;
  speedKhz: 100 | 400 | 1000;
  sinkMa?: number;
  series?: ESeries;
}
const RISE_NS = { 100: 1000, 400: 300, 1000: 120 } as const;
/** Диапазон подтяжки I²C по спецификации NXP UM10204: Rmin по току стока, Rmax по времени нарастания. */
export function i2cPullup({
  vccV,
  busCapPf,
  speedKhz,
  sinkMa = 3,
  series = 'E12',
}: I2cPullupInput) {
  const vol = 0.4;
  const minOhm = (vccV - vol) / (sinkMa / 1000);
  const maxOhm = (RISE_NS[speedKhz] * 1e-9) / (0.8473 * busCapPf * 1e-12);
  const feasible = minOhm <= maxOhm;
  // геометрическая середина диапазона, округлённая к ряду, но внутри диапазона
  let recommended = feasible ? nearestStandard(Math.sqrt(minOhm * maxOhm), series) : NaN;
  if (feasible && recommended > maxOhm) recommended = floorStandard(maxOhm, series);
  if (feasible && recommended < minOhm) recommended = ceilStandard(minOhm, series);
  return { minOhm, maxOhm, feasible, recommendedOhm: recommended };
}

export interface PullInput {
  vccV: number;
  /** Максимально допустимый ток через подтяжку при активном уровне, мА. */
  maxCurrentMa?: number;
  series?: ESeries;
}
/** Подтяжка кнопки/входа: не меньше Vcc/Imax; типовые 4.7–10 кОм. */
export function pullResistor({ vccV, maxCurrentMa = 0.5, series = 'E12' }: PullInput) {
  const minOhm = (vccV / maxCurrentMa) * 1000;
  const recommendedOhm = ceilStandard(Math.max(minOhm, 4700), series);
  return { minOhm, recommendedOhm, currentMa: (vccV / recommendedOhm) * 1000 };
}

export interface MosfetInput {
  vgsDriveV: number;
  vgsThMaxV: number;
  /** Rds(on) при известном Vgs (из даташита), Ом. */
  rdsOnOhm?: number;
  /** Напряжение Vgs, при котором дан rdsOnOhm. */
  rdsOnAtVgsV?: number;
  loadCurrentA?: number;
}
export type MosfetVerdict = 'ok' | 'marginal' | 'fail';
export function mosfetLogicLevel({
  vgsDriveV,
  vgsThMaxV,
  rdsOnOhm,
  rdsOnAtVgsV,
  loadCurrentA,
}: MosfetInput) {
  const marginV = vgsDriveV - vgsThMaxV;
  let verdict: MosfetVerdict = 'ok';
  if (marginV < 1)
    verdict = 'fail'; // порог почти не превышен: канал не откроется полностью
  else if (rdsOnAtVgsV !== undefined && vgsDriveV < rdsOnAtVgsV - 0.3) verdict = 'marginal'; // Rds(on) в даташите дан при большем Vgs
  const powerW =
    rdsOnOhm !== undefined && loadCurrentA !== undefined ? loadCurrentA ** 2 * rdsOnOhm : undefined;
  return { marginV, verdict, powerW };
}

export interface BudgetInput {
  sourceMa: number;
  loadsMa: number[];
  /** Запас, доля от источника (по умолчанию 20%). */
  reserve?: number;
}
export function currentBudget({ sourceMa, loadsMa, reserve = 0.2 }: BudgetInput) {
  const totalMa = loadsMa.reduce((s, v) => s + v, 0);
  const usableMa = sourceMa * (1 - reserve);
  return {
    totalMa,
    usableMa,
    headroomMa: usableMa - totalMa,
    ok: totalMa <= usableMa,
    utilization: totalMa / sourceMa,
  };
}

export interface BatteryInput {
  capacityMah: number;
  activeMa: number;
  sleepMa?: number;
  /** Доля времени в активном режиме, 0..1. */
  duty?: number;
  /** Полезная ёмкость (старение, отсечка, температура), по умолчанию 80%. */
  usableFraction?: number;
}
export function batteryLife({
  capacityMah,
  activeMa,
  sleepMa = 0,
  duty = 1,
  usableFraction = 0.8,
}: BatteryInput) {
  const avgMa = activeMa * duty + sleepMa * (1 - duty);
  if (!(avgMa > 0)) throw new RangeError('average current must be positive');
  const hours = (capacityMah * usableFraction) / avgMa;
  return { avgMa, hours, days: hours / 24 };
}

export interface LevelInput {
  driverV: number;
  receiverMaxV: number;
  receiverVihMinV: number;
}
export type LevelVerdict = 'ok' | 'too_low' | 'too_high';
/** Совместимость логических уровней драйвера и приёмника. */
export function levelCheck({ driverV, receiverMaxV, receiverVihMinV }: LevelInput) {
  const verdict: LevelVerdict =
    driverV > receiverMaxV + 1e-9
      ? 'too_high'
      : driverV < receiverVihMinV - 1e-9
        ? 'too_low'
        : 'ok';
  return { verdict, headroomV: receiverMaxV - driverV, marginV: driverV - receiverVihMinV };
}
