import { z } from 'zod';
import type { Calculation } from '../schema';
import {
  batteryLife,
  bjtBaseResistor,
  currentBudget,
  dividerDesign,
  dividerOut,
  i2cPullup,
  ledResistor,
  levelCheck,
  mosfetLogicLevel,
  pullResistor,
} from './formulas';
import type { ESeries } from './e-series';

export * from './e-series';
export * from './formulas';

export type CalcStatus = 'ok' | 'warn' | 'fail';
export interface CalcResult {
  type: CalcType;
  formula: string;
  /** Плоские числовые входы — ровно то, что попадает в Project.calculations[].inputs. */
  inputs: Record<string, number>;
  result: number;
  unit: string;
  status: CalcStatus;
  /** Дополнительные величины (точное значение, ток, мощность, вердикт...). */
  extra: Record<string, number | string | boolean>;
}

export class CalcError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'CalcError';
  }
}

const series = z
  .union([z.literal(12), z.literal(24)])
  .optional()
  .describe('E-series: 12 or 24');
const pos = z.number().positive();
const toSeries = (n: 12 | 24 | undefined): ESeries => (n === 12 ? 'E12' : 'E24');

/** Схемы входов: используются для валидации и как tool-схемы для ИИ. */
export const calcSchemas = {
  led_resistor: z.object({ vccV: pos, vfV: pos, ifMa: pos, series }).strict(),
  bjt_base_resistor: z
    .object({
      vdriveV: pos,
      vbeV: pos.optional(),
      icMa: pos,
      forcedBeta: pos.optional(),
      hfeMin: pos.optional(),
      series,
    })
    .strict(),
  voltage_divider: z.object({ vinV: z.number(), r1Ohm: pos, r2Ohm: pos }).strict(),
  divider_design: z.object({ vinV: pos, voutV: pos, r2Ohm: pos.optional(), series }).strict(),
  i2c_pullup: z
    .object({
      vccV: pos,
      busCapPf: pos,
      speedKhz: z.union([z.literal(100), z.literal(400), z.literal(1000)]),
      sinkMa: pos.optional(),
      series,
    })
    .strict(),
  pull_resistor: z.object({ vccV: pos, maxCurrentMa: pos.optional(), series }).strict(),
  mosfet_logic_level: z
    .object({
      vgsDriveV: pos,
      vgsThMaxV: pos,
      rdsOnOhm: pos.optional(),
      rdsOnAtVgsV: pos.optional(),
      loadCurrentA: pos.optional(),
    })
    .strict(),
  /** loads задаются ключами "load:<имя>" в мА. */
  current_budget: z.record(z.string(), z.number()),
  battery_life: z
    .object({
      capacityMah: pos,
      activeMa: pos,
      sleepMa: z.number().nonnegative().optional(),
      duty: z.number().min(0).max(1).optional(),
      usableFraction: z.number().min(0.1).max(1).optional(),
    })
    .strict(),
  level_check: z.object({ driverV: pos, receiverMaxV: pos, receiverVihMinV: pos }).strict(),
} as const;

export type CalcType = keyof typeof calcSchemas;
export const CALC_TYPES = Object.keys(calcSchemas) as CalcType[];
export const isCalcType = (s: string): s is CalcType => s in calcSchemas;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Единая точка входа для ИИ и UI: `calculate('led_resistor', {...})`. Бросает CalcError с понятным списком проблем. */
export function calculate(type: string, rawInputs: Record<string, number>): CalcResult {
  if (!isCalcType(type))
    throw new CalcError(`Unknown calculation type "${type}". Available: ${CALC_TYPES.join(', ')}`);
  const parsed = calcSchemas[type].safeParse(rawInputs);
  if (!parsed.success) {
    throw new CalcError(
      `Invalid inputs for ${type}`,
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const inputs = Object.fromEntries(
    Object.entries(rawInputs).filter(([, v]) => v !== undefined),
  ) as Record<string, number>;
  const i = parsed.data as Record<string, number | undefined>;
  const num = (k: string) => i[k] as number;
  try {
    switch (type) {
      case 'led_resistor': {
        const r = ledResistor({
          vccV: num('vccV'),
          vfV: num('vfV'),
          ifMa: num('ifMa'),
          series: toSeries(i.series as 12 | 24 | undefined),
        });
        return {
          type,
          formula: 'R = (Vcc − Vf) / If',
          inputs,
          result: r.standardOhm,
          unit: 'Ω',
          status: 'ok',
          extra: { ...r2all(r) },
        };
      }
      case 'bjt_base_resistor': {
        const r = bjtBaseResistor({
          vdriveV: num('vdriveV'),
          vbeV: i.vbeV,
          icMa: num('icMa'),
          forcedBeta: i.forcedBeta,
          hfeMin: i.hfeMin,
          series: toSeries(i.series as 12 | 24 | undefined),
        });
        return {
          type,
          formula: 'Rb = (Vdrive − Vbe) / (Ic / β)',
          inputs,
          result: r.standardOhm,
          unit: 'Ω',
          status: r.saturationMargin >= 1 ? 'ok' : 'warn',
          extra: r2all(r),
        };
      }
      case 'voltage_divider': {
        const vout = dividerOut(num('vinV'), num('r1Ohm'), num('r2Ohm'));
        return {
          type,
          formula: 'Vout = Vin · R2 / (R1 + R2)',
          inputs,
          result: r2(vout),
          unit: 'V',
          status: 'ok',
          extra: { currentMa: r2((num('vinV') / (num('r1Ohm') + num('r2Ohm'))) * 1000) },
        };
      }
      case 'divider_design': {
        const r = dividerDesign({
          vinV: num('vinV'),
          voutV: num('voutV'),
          r2Ohm: i.r2Ohm,
          series: toSeries(i.series as 12 | 24 | undefined),
        });
        const err = Math.abs(r.actualOutV / num('voutV') - 1);
        return {
          type,
          formula: 'R1 = R2 · (Vin − Vout) / Vout',
          inputs,
          result: r.r1Ohm,
          unit: 'Ω',
          status: err > 0.05 ? 'warn' : 'ok',
          extra: r2all(r),
        };
      }
      case 'i2c_pullup': {
        const r = i2cPullup({
          vccV: num('vccV'),
          busCapPf: num('busCapPf'),
          speedKhz: num('speedKhz') as 100 | 400 | 1000,
          sinkMa: i.sinkMa,
          series: toSeries(i.series as 12 | 24 | undefined),
        });
        return {
          type,
          formula: 'Rmin = (Vcc − 0.4 V) / 3 mA;  Rmax = tr / (0.8473 · Cb)',
          inputs,
          result: r.recommendedOhm,
          unit: 'Ω',
          status: r.feasible ? 'ok' : 'fail',
          extra: r2all(r),
        };
      }
      case 'pull_resistor': {
        const r = pullResistor({
          vccV: num('vccV'),
          maxCurrentMa: i.maxCurrentMa,
          series: toSeries(i.series as 12 | 24 | undefined),
        });
        return {
          type,
          formula: 'R ≥ Vcc / Imax',
          inputs,
          result: r.recommendedOhm,
          unit: 'Ω',
          status: 'ok',
          extra: r2all(r),
        };
      }
      case 'mosfet_logic_level': {
        const r = mosfetLogicLevel({
          vgsDriveV: num('vgsDriveV'),
          vgsThMaxV: num('vgsThMaxV'),
          rdsOnOhm: i.rdsOnOhm,
          rdsOnAtVgsV: i.rdsOnAtVgsV,
          loadCurrentA: i.loadCurrentA,
        });
        const extra: CalcResult['extra'] = { verdict: r.verdict };
        if (r.powerW !== undefined) extra.powerW = r2(r.powerW * 1000) / 1000;
        return {
          type,
          formula: 'margin = Vgs − Vgs(th)max;  P = I² · Rds(on)',
          inputs,
          result: r2(r.marginV),
          unit: 'V',
          status: r.verdict === 'ok' ? 'ok' : r.verdict === 'marginal' ? 'warn' : 'fail',
          extra,
        };
      }
      case 'current_budget': {
        const loads = Object.entries(rawInputs).filter(([k]) => k.startsWith('load:'));
        const r = currentBudget({
          sourceMa: rawInputs.sourceMa,
          loadsMa: loads.map(([, v]) => v),
          reserve: rawInputs.reserve,
        });
        if (!(rawInputs.sourceMa > 0))
          throw new CalcError('Invalid inputs for current_budget', [
            'sourceMa: required, must be positive',
          ]);
        return {
          type,
          formula: 'Σ I_load ≤ I_source · (1 − reserve)',
          inputs,
          result: r2(r.totalMa),
          unit: 'mA',
          status: r.ok ? 'ok' : 'fail',
          extra: r2all(r),
        };
      }
      case 'battery_life': {
        const r = batteryLife({
          capacityMah: num('capacityMah'),
          activeMa: num('activeMa'),
          sleepMa: i.sleepMa,
          duty: i.duty,
          usableFraction: i.usableFraction,
        });
        return {
          type,
          formula: 't = C · k / (I_active · duty + I_sleep · (1 − duty))',
          inputs,
          result: r2(r.hours),
          unit: 'h',
          status: 'ok',
          extra: r2all(r),
        };
      }
      case 'level_check': {
        const r = levelCheck({
          driverV: num('driverV'),
          receiverMaxV: num('receiverMaxV'),
          receiverVihMinV: num('receiverVihMinV'),
        });
        return {
          type,
          formula: 'Vih_min ≤ V_driver ≤ V_max',
          inputs,
          result: r2(r.headroomV),
          unit: 'V',
          status: r.verdict === 'ok' ? 'ok' : 'fail',
          extra: { verdict: r.verdict, marginV: r2(r.marginV) },
        };
      }
    }
  } catch (e) {
    if (e instanceof CalcError) throw e;
    if (e instanceof RangeError) throw new CalcError(e.message, [e.message]);
    throw e;
  }
}

function r2all(o: Record<string, unknown>): Record<string, number | string | boolean> {
  return Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [
        k,
        typeof v === 'number' ? Math.round(v * 1000) / 1000 : (v as string | boolean),
      ]),
  );
}

/** Результат калькулятора → запись Project.calculations (текст пояснения пишет вызывающий). */
export function toProjectCalculation(
  res: CalcResult,
  meta: { id: string; title: string; explanation: string },
): Calculation {
  return {
    id: meta.id,
    title: meta.title,
    formula: res.formula,
    inputs: res.inputs,
    result: res.result,
    unit: res.unit,
    explanation: meta.explanation,
  };
}

/** Тип калькулятора из id записи проекта: "led-resistor", "led_resistor:led1" → led_resistor. */
export function calcTypeFromId(id: string): CalcType | undefined {
  const base = id.split(':')[0].replace(/-/g, '_');
  return isCalcType(base) ? base : undefined;
}
export * from './fields';
export * from './verify';
