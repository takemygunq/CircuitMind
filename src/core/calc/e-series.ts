export type ESeries = 'E12' | 'E24';

const BASE: Record<ESeries, number[]> = {
  E12: [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2],
  E24: [
    1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6,
    6.2, 6.8, 7.5, 8.2, 9.1,
  ],
};

/** Значения ряда в пределах нескольких декад вокруг value (по возрастанию). */
function candidates(value: number, series: ESeries): number[] {
  const decade = Math.floor(Math.log10(value));
  const out: number[] = [];
  for (let d = decade - 1; d <= decade + 1; d++)
    for (const b of BASE[series]) out.push(round(b * 10 ** d));
  return out;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

function check(value: number): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`E-series value must be positive, got ${value}`);
}

/** Ближайшее значение ряда (в логарифмической шкале). */
export function nearestStandard(value: number, series: ESeries = 'E24'): number {
  check(value);
  return candidates(value, series).reduce((best, c) =>
    Math.abs(Math.log(c / value)) < Math.abs(Math.log(best / value)) ? c : best,
  );
}

/** Ближайшее значение ряда не меньше value (безопасно для токоограничивающих резисторов). */
export function ceilStandard(value: number, series: ESeries = 'E24'): number {
  check(value);
  return candidates(value, series).find((c) => c >= value * (1 - 1e-9))!;
}

/** Ближайшее значение ряда не больше value (безопасно для базовых резисторов). */
export function floorStandard(value: number, series: ESeries = 'E24'): number {
  check(value);
  const list = candidates(value, series);
  for (let i = list.length - 1; i >= 0; i--) if (list[i] <= value * (1 + 1e-9)) return list[i];
  return list[0];
}

/** Входит ли значение в ряд (допуск 1%, т.к. номиналы округляют до 2 знаков). */
export function isStandard(value: number, series: ESeries = 'E24', tolerance = 0.011): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  return Math.abs(nearestStandard(value, series) / value - 1) <= tolerance;
}
