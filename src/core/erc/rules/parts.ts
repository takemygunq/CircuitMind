import { calculate } from '../../calc';
import { ledLoad, sourceVoltage, viaResistor } from '../analysis';
import type { Ep, ErcContext } from '../context';

const r2 = (v: number) => Math.round(v * 100) / 100;

function ledRules(ctx: ErcContext): void {
  for (const { inst, def } of ctx.knownParts()) {
    if (def.kind !== 'led') continue;
    const load = ledLoad(ctx, inst.instanceId, def);
    if (!load) continue;
    if (!load.hasResistor) {
      ctx.add('led_no_resistor', 'error', [inst.instanceId], { part: inst.instanceId });
      continue;
    }
    if (load.ma !== undefined && load.limitMa !== undefined && load.ma > load.limitMa + 1e-6)
      ctx.add('led_overcurrent', 'error', [inst.instanceId], {
        part: inst.instanceId,
        ma: r2(load.ma),
        limit: load.limitMa,
      });
  }
}

function transistorRules(ctx: ErcContext): void {
  for (const { inst, def } of ctx.knownParts()) {
    if (def.kind === 'npn') {
      const b = ctx.netOf(inst.instanceId, 'B');
      if (b === undefined) continue;
      if (ctx.netEps(b).some((e) => e.isBoard && !ctx.isGnd(e) && !ctx.isSupplyPin(e))) {
        ctx.add('base_no_resistor', 'error', [`${inst.instanceId}:B`], { part: inst.instanceId });
        continue;
      }
      const drive = viaResistor(ctx, b, inst.instanceId);
      const collector = ctx.netOf(inst.instanceId, 'C');
      const loads =
        collector === undefined
          ? []
          : ctx.netEps(collector).filter((e) => !e.isBoard && e.ref !== inst.instanceId);
      const ic = Math.max(
        0,
        ...loads.map(
          (e) =>
            ctx.param(e.def, 'runCurrentMa') ??
            ctx.param(e.def, 'coilCurrentMa') ??
            ctx.param(e.def, 'currentMa') ??
            0,
        ),
      );
      const icMax = ctx.param(def, 'icMaxMa');
      if (icMax !== undefined && ic > icMax + 1e-6)
        ctx.add('transistor_overload', 'error', [inst.instanceId], {
          part: inst.instanceId,
          ma: ic,
          limit: icMax,
        });
      if (drive && ic > 0) {
        const ib = (Math.max(0, drive.v - 0.7) / drive.r) * 1000;
        const hfe = ctx.param(def, 'hfeMin') ?? 10;
        if (ib * hfe < ic)
          ctx.add('transistor_saturation', 'error', [inst.instanceId], {
            part: inst.instanceId,
            ib: r2(ib),
            ic,
            hfe,
          });
        else if (ib * 10 < ic)
          ctx.add('transistor_saturation', 'warning', [inst.instanceId], {
            part: inst.instanceId,
            ib: r2(ib),
            ic,
            hfe: 10,
          });
      }
    }
    if (def.kind === 'nmos') {
      const g = ctx.netOf(inst.instanceId, 'G');
      if (g === undefined) continue;
      const v = sourceVoltage(ctx, g) ?? viaResistor(ctx, g, inst.instanceId)?.v;
      const th = ctx.param(def, 'vgsThMaxV');
      if (v === undefined || th === undefined) continue;
      const res = calculate('mosfet_logic_level', {
        vgsDriveV: v,
        vgsThMaxV: th,
        ...(ctx.param(def, 'rdsOnOhm5V') !== undefined
          ? { rdsOnOhm: ctx.param(def, 'rdsOnOhm5V')!, rdsOnAtVgsV: 5 }
          : {}),
      });
      if (res.status === 'fail')
        ctx.add('mosfet_logic_level', 'error', [`${inst.instanceId}:G`], {
          part: inst.instanceId,
          v: r2(v),
          th,
          level: 'fail',
        });
      else if (res.status === 'warn')
        ctx.add('mosfet_logic_level', 'warning', [`${inst.instanceId}:G`], {
          part: inst.instanceId,
          v: r2(v),
          th,
          level: 'marginal',
        });
    }
  }
}

function inductiveRules(ctx: ErcContext): void {
  for (const { inst, def } of ctx.knownParts()) {
    if (!ctx.param(def, 'inductive')) continue;
    const coil = def.pins.filter((p) => /^(M[+-]|COIL[+-])$/.test(p.id));
    const pins = coil.length === 2 ? coil : def.pins.slice(0, 2);
    const nets = pins.map((p) => ctx.netOf(inst.instanceId, p.id));
    if (nets.some((n) => n === undefined)) continue;
    const [pos, neg] = pins.map((p) => p.id.endsWith('+')).includes(true)
      ? [pins.find((p) => p.id.endsWith('+'))!, pins.find((p) => p.id.endsWith('-'))!]
      : [pins[0], pins[1]];
    const posNet = ctx.netOf(inst.instanceId, pos.id)!;
    const negNet = ctx.netOf(inst.instanceId, neg.id)!;

    // питание катушки/мотора напрямую от GPIO
    for (const n of [posNet, negNet])
      for (const e of ctx.netEps(n))
        if (e.isBoard && !ctx.isGnd(e) && !ctx.isSupplyPin(e))
          ctx.add('inductive_direct_gpio', 'error', [e.endpoint, inst.instanceId], {
            part: inst.instanceId,
            pin: e.pin?.id ?? e.pinId,
          });

    const diodes = [...ctx.knownParts()].filter((p) => p.def.kind === 'diode');
    let ok = false;
    let reversed = false;
    for (const d of diodes) {
      const anode = ctx.netOf(d.inst.instanceId, 'anode');
      const cathode = ctx.netOf(d.inst.instanceId, 'cathode');
      if (anode === negNet && cathode === posNet) ok = true; // катод к «плюсу» катушки
      if (anode === posNet && cathode === negNet) reversed = true;
    }
    if (!ok)
      ctx.add(
        reversed ? 'flyback_diode_reversed' : 'inductive_no_flyback',
        'error',
        [inst.instanceId],
        { part: inst.instanceId },
      );
  }
}

function mainsRules(ctx: ErcContext): void {
  const mains = [...ctx.knownParts()].filter((p) => ctx.param(p.def, 'mainsCapable'));
  for (const m of mains)
    ctx.add('mains_warning', 'danger', [m.inst.instanceId], { part: m.def.name });
  if (mains.length && !ctx.project.warnings.some((w) => w.level === 'danger'))
    ctx.add(
      'missing_mains_warning',
      'error',
      mains.map((m) => m.inst.instanceId),
      { part: mains[0].def.name },
    );
}

function pullupRules(ctx: ErcContext): void {
  const resistorsToRail = (netId: number): Ep[] =>
    ctx.netEps(netId).filter((e) => {
      if (e.def?.kind !== 'resistor') return false;
      const o = ctx.otherPin(e);
      return o?.netId !== undefined && (ctx.netVoltage(o.netId) ?? 0) > 0;
    });

  for (const { inst, def } of ctx.knownParts()) {
    const pinId = def.params.pullupPin;
    if (typeof pinId !== 'string') continue;
    const net = ctx.netOf(inst.instanceId, pinId);
    if (net === undefined) continue;
    const pulls = resistorsToRail(net);
    const min = ctx.param(def, 'pullupMinOhm');
    const max = ctx.param(def, 'pullupMaxOhm');
    if (!pulls.length)
      ctx.add('missing_pullup', 'error', [`${inst.instanceId}:${pinId}`], {
        part: def.name,
        min: min ?? 0,
        max: max ?? 0,
      });
    else if (
      pulls.every(
        (p) =>
          (min !== undefined && ctx.ohms(p) < min * 0.99) ||
          (max !== undefined && ctx.ohms(p) > max * 1.01),
      )
    )
      ctx.add('pullup_value', 'warning', [pulls[0].endpoint], {
        part: def.name,
        r: ctx.ohms(pulls[0]),
        min: min ?? 0,
        max: max ?? 0,
      });
  }

  // шина I²C
  const buses = new Map<number, Ep[]>();
  for (const net of ctx.nets.nets) {
    const eps = ctx
      .netEps(net.id)
      .filter((e) => e.pin?.functions.some((f) => f === 'i2c_sda' || f === 'i2c_scl'));
    if (eps.length) buses.set(net.id, eps);
  }
  for (const [netId, eps] of buses) {
    const builtIn = eps.some((e) => !e.isBoard && (ctx.param(e.def, 'hasPullups') ?? 0) > 0);
    if (!builtIn && !resistorsToRail(netId).length)
      ctx.add(
        'i2c_pullup_missing',
        'warning',
        eps.map((e) => e.endpoint),
        { net: ctx.nets.nets[netId].name },
      );
    if (eps.some((e) => e.pin?.functions.includes('i2c_sda'))) {
      const byAddr = new Map<string, string>();
      for (const e of eps.filter((e) => !e.isBoard)) {
        const addr = e.def?.params.i2cAddress;
        if (typeof addr !== 'string') continue;
        const key = addr.toLowerCase();
        const other = byAddr.get(key);
        if (other)
          ctx.add('i2c_address_conflict', 'error', [other, e.ref], { addr, a: other, b: e.ref });
        else byAddr.set(key, e.ref);
      }
    }
  }
}

export function partRules(ctx: ErcContext): void {
  ledRules(ctx);
  transistorRules(ctx);
  inductiveRules(ctx);
  mainsRules(ctx);
  pullupRules(ctx);
}
