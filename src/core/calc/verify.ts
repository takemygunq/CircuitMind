import type { Calculation } from '../schema';
import { CalcError, calcTypeFromId, calculate, type CalcResult } from './index';
import { ceilStandard, floorStandard, nearestStandard } from './e-series';

const UNIT_FACTOR: Record<string, [string, number]> = {
  ω: ['Ω', 1],
  ом: ['Ω', 1],
  ohm: ['Ω', 1],
  ohms: ['Ω', 1],
  Ω: ['Ω', 1],
  kω: ['Ω', 1e3],
  ком: ['Ω', 1e3],
  kohm: ['Ω', 1e3],
  kΩ: ['Ω', 1e3],
  v: ['V', 1],
  в: ['V', 1],
  ma: ['mA', 1],
  ма: ['mA', 1],
  h: ['h', 1],
  ч: ['h', 1],
};
/** "Ом", "kΩ", "мА" → [каноническая единица, множитель]. */
export function normalizeUnit(unit: string): [string, number] | undefined {
  return UNIT_FACTOR[unit.trim().toLowerCase()] ?? UNIT_FACTOR[unit.trim()];
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.015 * Math.abs(b), 0.01);

export type CalcCheck =
  | { status: 'unknown' } // id не соответствует ни одному калькулятору — пересчитать нельзя
  | { status: 'invalid'; reason: string }
  | { status: 'match'; expected: CalcResult }
  | { status: 'mismatch'; expected: CalcResult };

/**
 * Пересчитывает запись проекта собственными формулами и сверяет с тем, что написал ИИ.
 * Принимаются точное значение и соседние значения рядов E12/E24 (ИИ вправе округлить), разные написания единиц.
 */
export function checkCalculation(
  calc: Pick<Calculation, 'id' | 'inputs' | 'result' | 'unit'>,
): CalcCheck {
  const type = calcTypeFromId(calc.id);
  if (!type) return { status: 'unknown' };
  let expected: CalcResult;
  try {
    expected = calculate(type, calc.inputs);
  } catch (e) {
    return {
      status: 'invalid',
      reason: e instanceof CalcError ? (e.issues[0] ?? e.message) : String(e),
    };
  }
  const unit = normalizeUnit(calc.unit);
  const expectedUnit = normalizeUnit(expected.unit) ?? [expected.unit, 1];
  if (unit && unit[0] !== expectedUnit[0]) return { status: 'mismatch', expected };
  const value = calc.result * (unit?.[1] ?? 1);
  const accepted = new Set<number>([expected.result]);
  for (const key of ['exactOhm', 'exactR1Ohm'] as const) {
    const exact = expected.extra[key];
    if (typeof exact === 'number' && exact > 0) {
      accepted.add(exact);
      for (const s of ['E12', 'E24'] as const)
        [nearestStandard(exact, s), ceilStandard(exact, s), floorStandard(exact, s)].forEach((v) =>
          accepted.add(v),
        );
    }
  }
  return [...accepted].some((a) => close(value, a))
    ? { status: 'match', expected }
    : { status: 'mismatch', expected };
}
