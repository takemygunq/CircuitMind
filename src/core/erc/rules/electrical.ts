import { analyzePower } from '../analysis';
import type { Ep, ErcContext } from '../context';

const r2 = (v: number) => Math.round(v * 100) / 100;
const isDriver = (e: Ep) => e.pin?.electrical === 'output' || e.pin?.electrical === 'bidirectional';
const isReceiver = (e: Ep) =>
  e.pin?.electrical === 'input' || e.pin?.electrical === 'bidirectional';
const isSignal = (ctx: ErcContext, e: Ep) =>
  !!e.pin &&
  !ctx.isGnd(e) &&
  e.pin.electrical !== 'power_in' &&
  e.pin.electrical !== 'power_out' &&
  e.pin.electrical !== 'passive';

/** Согласование логических уровней, в том числе через резисторный делитель. */
function levelRules(ctx: ErcContext): void {
  for (const net of ctx.nets.nets) {
    const eps = ctx.netEps(net.id).filter((e) => isSignal(ctx, e));
    for (const d of eps.filter(isDriver)) {
      const vd = ctx.signalVoltage(d);
      if (vd === undefined || vd <= 0) continue;
      for (const r of eps.filter(isReceiver)) {
        if (r.endpoint === d.endpoint) continue;
        const max = ctx.maxInputV(r);
        const min = ctx.minHighV(r);
        if (max !== undefined && vd > max + 1e-6)
          ctx.add('level_overvoltage', 'error', [d.endpoint, r.endpoint], {
            from: d.endpoint,
            to: r.endpoint,
            v: r2(vd),
            max: r2(max),
            how: 'direct',
          });
        else if (min !== undefined && vd < min - 1e-6)
          ctx.add('level_undervoltage', 'warning', [d.endpoint, r.endpoint], {
            from: d.endpoint,
            to: r.endpoint,
            v: r2(vd),
            min: r2(min),
          });
      }
    }
  }

  // Драйвер с другой стороны резистора: последовательный R, либо делитель R1 + R2 на землю
  for (const net of ctx.nets.nets) {
    const eps = ctx.netEps(net.id);
    const receivers = eps.filter(
      (e) => isSignal(ctx, e) && isReceiver(e) && ctx.maxInputV(e) !== undefined,
    );
    if (!receivers.length) continue;
    const resistors = eps.filter((e) => e.def?.kind === 'resistor' && Number.isFinite(ctx.ohms(e)));
    const shunts = resistors.filter((r) => {
      const o = ctx.otherPin(r);
      return o?.netId !== undefined && ctx.netVoltage(o.netId) === 0;
    });
    for (const series of resistors.filter((r) => !shunts.includes(r))) {
      const o = ctx.otherPin(series);
      if (o?.netId === undefined) continue;
      for (const d of ctx.netEps(o.netId).filter((e) => isSignal(ctx, e) && isDriver(e))) {
        const vd = ctx.signalVoltage(d);
        if (vd === undefined || vd <= 0) continue;
        const r1 = ctx.ohms(series);
        const conductance = shunts.reduce((s, r) => s + 1 / ctx.ohms(r), 0);
        const vin = conductance > 0 ? vd / (1 + r1 * conductance) : vd;
        for (const rcv of receivers) {
          const max = ctx.maxInputV(rcv)!;
          if (vin > max + 1e-6)
            ctx.add('level_overvoltage', 'error', [d.endpoint, rcv.endpoint], {
              from: d.endpoint,
              to: rcv.endpoint,
              v: r2(vin),
              max: r2(max),
              how: conductance > 0 ? 'divider' : 'series',
            });
        }
      }
    }
  }
}

/** Токи пинов, шин питания и общий бюджет (цифры — из analysis.ts, те же, что видит пользователь). */
function currentRules(ctx: ErcContext): void {
  const a = analyzePower(ctx);
  for (const p of a.gpio)
    if (p.limitMa !== undefined && p.estMa > p.limitMa + 1e-6)
      ctx.add('pin_overcurrent', 'error', [p.endpoint], {
        pin: p.pin,
        ma: r2(p.estMa),
        limit: p.limitMa,
      });
  if (a.gpioLimitMa !== undefined && a.gpioTotalMa > a.gpioLimitMa + 1e-6)
    ctx.add('gpio_total_overcurrent', 'error', ['board'], {
      ma: r2(a.gpioTotalMa),
      limit: a.gpioLimitMa,
    });

  for (const r of a.rails) {
    if (r.ma > r.limitMa + 1e-6)
      ctx.add('rail_overload', 'error', [r.endpoint], {
        pin: r.pin,
        ma: r2(r.ma),
        limit: r.limitMa,
      });
    else if (r.ma > r.limitMa * 0.8)
      ctx.add('rail_overload', 'warning', [r.endpoint], {
        pin: r.pin,
        ma: r2(r.ma),
        limit: r.limitMa,
      });
    for (const peak of r.peaks)
      if (peak.ma > r.limitMa * 0.5)
        ctx.add('high_current_from_rail', 'warning', [peak.endpoint], {
          part: peak.part,
          ma: peak.ma,
          limit: r.limitMa,
          pin: r.pin,
        });
  }
  if (a.totalMa > a.budgetMa + 1e-6)
    ctx.add('power_budget', 'error', ['board'], { ma: r2(a.totalMa), limit: a.budgetMa });
  else if (a.totalMa > a.budgetMa * 0.8)
    ctx.add('power_budget', 'warning', ['board'], { ma: r2(a.totalMa), limit: a.budgetMa });
}

export function electricalRules(ctx: ErcContext): void {
  levelRules(ctx);
  currentRules(ctx);
}
