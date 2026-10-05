import type { ComponentDef } from '../schema';
import { boardFor, ErcContext, type ErcOptions } from './context';
import type { Project } from '../schema';

/** Напряжение источника в цепи: пин питания платы или GPIO (если он напрямую в этой цепи). */
export function sourceVoltage(ctx: ErcContext, netId: number | undefined): number | undefined {
  if (netId === undefined) return undefined;
  for (const e of ctx.netEps(netId)) {
    if (!e.isBoard || ctx.isGnd(e)) continue;
    return ctx.isSupplyPin(e) ? ctx.supplyVoltage(e) : ctx.signalVoltage(e);
  }
  return undefined;
}

/**
 * Что находится на конце цепи: напрямую пин платы, либо через один резистор.
 * wantGnd — ищем землю; иначе — источник (питание или GPIO).
 */
export function terminal(
  ctx: ErcContext,
  netId: number | undefined,
  wantGnd: boolean,
  exclude: string,
): { v: number; r: number } | undefined {
  if (netId === undefined) return undefined;
  const direct = (id: number): number | undefined => {
    for (const e of ctx.netEps(id)) {
      if (!e.isBoard) continue;
      if (wantGnd) {
        if (ctx.isGnd(e)) return 0;
      } else if (!ctx.isGnd(e)) {
        return ctx.isSupplyPin(e) ? ctx.supplyVoltage(e) : ctx.signalVoltage(e);
      }
    }
    return undefined;
  };
  const d = direct(netId);
  if (d !== undefined) return { v: d, r: 0 };
  for (const e of ctx.netEps(netId)) {
    if (e.def?.kind !== 'resistor' || e.ref === exclude) continue;
    const o = ctx.otherPin(e);
    const v = o?.netId === undefined ? undefined : direct(o.netId);
    const r = ctx.ohms(e);
    if (v !== undefined && Number.isFinite(r)) return { v, r };
  }
  return undefined;
}

export const viaResistor = (ctx: ErcContext, netId: number | undefined, exclude: string) => {
  const t = terminal(ctx, netId, false, exclude);
  return t && t.r > 0 ? t : undefined;
};

export interface LedLoad {
  part: string;
  /** Ток светодиода, мА; undefined — не удалось определить (например, ключ на транзисторе). */
  ma: number | undefined;
  limitMa: number | undefined;
  /** Есть токоограничивающий резистор в цепи. */
  hasResistor: boolean;
}

export function ledLoad(ctx: ErcContext, partId: string, def: ComponentDef): LedLoad | undefined {
  const a = ctx.netOf(partId, 'anode');
  const c = ctx.netOf(partId, 'cathode');
  if (a === undefined || c === undefined) return undefined;
  const hasR = (n: number) => ctx.netEps(n).some((e) => e.def?.kind === 'resistor');
  const hasResistor = hasR(a) || hasR(c);
  const vf = ctx.param(def, 'vfV') ?? 2;
  const src = terminal(ctx, a, false, partId);
  const sink = terminal(ctx, c, true, partId);
  const ma =
    hasResistor && src && sink && src.r + sink.r > 0
      ? (Math.max(0, src.v - sink.v - vf) / (src.r + sink.r)) * 1000
      : undefined;
  return { part: partId, ma, limitMa: ctx.param(def, 'ifMaxMa'), hasResistor };
}

export function analyzeLeds(ctx: ErcContext): LedLoad[] {
  const out: LedLoad[] = [];
  for (const { inst, def } of ctx.knownParts()) {
    if (def.kind !== 'led') continue;
    const l = ledLoad(ctx, inst.instanceId, def);
    if (l) out.push(l);
  }
  return out;
}

export interface PinLoad {
  endpoint: string;
  pin: string;
  /** Ток, который пин отдаёт в нагрузку (светодиоды, базы, питание модулей, подтяжки к земле), мА. */
  sourceMa: number;
  /** Ток, который пин принимает (подтяжка к питанию при низком уровне), мА. */
  sinkMa: number;
  /** Расчётный ток для сравнения с лимитом: максимум из двух. */
  estMa: number;
  limitMa: number | undefined;
}
export interface RailLoad {
  endpoint: string;
  pin: string;
  voltage: number;
  ma: number;
  limitMa: number;
  /** Пик (сервопривод/мотор) от этого пина питания, мА. */
  peaks: { part: string; endpoint: string; ma: number }[];
}
export interface PowerAnalysis {
  selfMa: number;
  gpio: PinLoad[];
  gpioTotalMa: number;
  gpioLimitMa: number | undefined;
  rails: RailLoad[];
  totalMa: number;
  budgetMa: number;
}

/** Токи пинов, шин питания и общий баланс питания проекта (оценка по резистивным цепочкам). */
export function analyzePower(ctx: ErcContext): PowerAnalysis {
  const { board, project } = ctx;
  const gpio: PinLoad[] = [];
  for (const net of ctx.nets.nets) {
    for (const bp of ctx
      .netEps(net.id)
      .filter(
        (e) =>
          e.isBoard &&
          e.pin &&
          !ctx.isGnd(e) &&
          !ctx.isSupplyPin(e) &&
          e.pin.functions.includes('gpio'),
      )) {
      const v = ctx.signalVoltage(bp) ?? board.logicVoltage;
      const { loadMa, pullMa } = ctx.netLoad(net.id, v, bp.endpoint);
      const sourceMa = loadMa + pullMa;
      let sinkMa = 0;
      for (const e of ctx.netEps(net.id).filter((e) => e.def?.kind === 'resistor')) {
        const o = ctx.otherPin(e);
        const vr = ctx.isRail(o?.netId) ? ctx.netVoltage(o!.netId) : undefined;
        if (vr && Number.isFinite(ctx.ohms(e))) sinkMa += (vr / ctx.ohms(e)) * 1000;
      }
      gpio.push({
        endpoint: bp.endpoint,
        pin: bp.pin!.id,
        sourceMa,
        sinkMa,
        estMa: Math.max(sourceMa, sinkMa),
        limitMa: bp.pin!.maxCurrentMa,
      });
    }
  }
  const gpioTotalMa = gpio.reduce((s, p) => s + p.sourceMa, 0);

  const rails: RailLoad[] = [];
  const seen = new Set<number>();
  for (const net of ctx.nets.nets) {
    for (const sp of ctx.netEps(net.id).filter((e) => e.isBoard && e.pin && ctx.isSupplyPin(e))) {
      if (seen.has(net.id)) break;
      seen.add(net.id);
      const voltage = ctx.supplyVoltage(sp) ?? 0;
      const { loadMa, pullMa } = ctx.netLoad(net.id, voltage, sp.endpoint);
      const rail = board.rails.find((r) => r.pinId === sp.pin!.id);
      const peaks = ctx
        .netEps(net.id)
        .filter((e) => !e.isBoard && e.pin?.electrical === 'power_in')
        .flatMap((e) => {
          const stall = ctx.param(e.def, 'stallCurrentMa');
          return stall !== undefined
            ? [{ part: e.def!.name, endpoint: e.endpoint, ma: stall }]
            : [];
        });
      rails.push({
        endpoint: sp.endpoint,
        pin: sp.pin!.id,
        voltage,
        ma: loadMa + pullMa,
        limitMa: rail?.maxCurrentMa ?? project.power.budgetMa,
        peaks,
      });
      peaks.map((p) => p.endpoint);
    }
  }
  const selfMa = board.selfCurrentMa ?? 0;
  return {
    selfMa,
    gpio,
    gpioTotalMa,
    gpioLimitMa: board.maxTotalCurrentMa,
    rails,
    totalMa: selfMa + gpioTotalMa + rails.reduce((s, r) => s + r.ma, 0),
    budgetMa: project.power.budgetMa,
  };
}

export interface CircuitAnalysis {
  power: PowerAnalysis;
  leds: LedLoad[];
}

/** Количественный анализ проекта для вкладки «Расчёты». Не проверяет правила — только считает. */
export function analyzeCircuit(
  project: Project,
  opts: ErcOptions = {},
): CircuitAnalysis | undefined {
  const board = boardFor(project, opts);
  if (!board) return undefined;
  const ctx = new ErcContext(project, board, opts);
  return { power: analyzePower(ctx), leds: analyzeLeds(ctx) };
}
