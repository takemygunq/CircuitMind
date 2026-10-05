import { ErcContext } from '../erc/context';
import type { BoardDef, ComponentDef, Project } from '../schema';
import { buildNetlist, defaultSimState, type SimState } from './netlist';
import { solveDc } from './mna';

export interface PinState {
  /** Напряжение на выводе, В. */
  v: number;
  /** Ток, втекающий в устройство через вывод, А (у источников платы — отрицательный, если они отдают ток). */
  i: number;
}
export type PartStatus = 'ok' | 'warn' | 'burnt' | 'off' | 'idle';
export type FailReason = 'overcurrent' | 'overpower' | 'overvoltage';

export interface PartResult {
  id: string;
  kind: string | undefined;
  status: PartStatus;
  reason?: FailReason;
  /** Отношение нагрузки к допустимой (1 = предел). */
  stress?: number;
  /** Основной ток детали, А, и падение напряжения, В. */
  i?: number;
  v?: number;
  p?: number;
  /** Яркость светодиода 0..1.2 относительно типового тока. */
  glow?: number;
  pins: Record<string, PinState>;
}

export interface WireResult {
  /** Ток по проводу, А; знак — относительно направления from → to. */
  i: number;
  v: number;
}

export interface SimWarning {
  code: 'pin_overcurrent' | 'rail_overload' | 'short_circuit' | 'nonconverged';
  ref: string;
  value: number;
  limit?: number;
}

export interface SimResult {
  status: 'ok' | 'nonconverged' | 'singular';
  iterations: number;
  parts: Record<string, PartResult>;
  /** Состояние пинов платы. */
  board: Record<string, PinState>;
  /** Все подключённые выводы: "ref:pin" → напряжение и ток. */
  endpoints: Record<string, PinState>;
  /** По одному элементу на соединение проекта. */
  wires: WireResult[];
  /** Вышедшие из строя детали. */
  failed: Record<string, FailReason>;
  warnings: SimWarning[];
}

/** Порог «перегорания» относительно допустимого значения. */
const BURN = { led: 1.5, diode: 1.5, resistor: 3, npn: 1.5, nmos: 1.5, supply: 1.25 } as const;

interface Stress {
  stress: number;
  burnAt: number;
  reason: FailReason;
  i?: number;
  v?: number;
  p?: number;
}

/**
 * Распределение тока по проводам цепи. Идеальные провода не определяют токи однозначно в замкнутых контурах,
 * поэтому поток считается по остовному дереву цепи: через ребро течёт сумма токов потребителей «за» ним.
 */
export function wireFlows(
  project: Pick<Project, 'connections'>,
  ctx: Pick<ErcContext, 'nets'>,
  endpointI: Record<string, number>,
): number[] {
  const flows = new Array<number>(project.connections.length).fill(0);
  for (const net of ctx.nets.nets) {
    const adj = new Map<string, { to: string; conn: number }[]>();
    for (const c of net.connections) {
      const { from, to } = project.connections[c];
      (adj.get(from) ?? adj.set(from, []).get(from)!).push({ to, conn: c });
      (adj.get(to) ?? adj.set(to, []).get(to)!).push({ to: from, conn: c });
    }
    const root = [...net.endpoints].sort(
      (a, b) => Math.abs(endpointI[b] ?? 0) - Math.abs(endpointI[a] ?? 0),
    )[0];
    if (!root) continue;
    const parent = new Map<string, { from: string; conn: number }>();
    const order: string[] = [root];
    const seen = new Set([root]);
    for (let k = 0; k < order.length; k++)
      for (const { to, conn } of adj.get(order[k]) ?? [])
        if (!seen.has(to)) {
          seen.add(to);
          parent.set(to, { from: order[k], conn });
          order.push(to);
        }
    const sub = new Map<string, number>(order.map((e) => [e, endpointI[e] ?? 0]));
    for (let k = order.length - 1; k > 0; k--) {
      const e = order[k];
      const p = parent.get(e)!;
      sub.set(p.from, (sub.get(p.from) ?? 0) + (sub.get(e) ?? 0));
      const flowDownstream = sub.get(e) ?? 0; // от родителя к потомку
      flows[p.conn] =
        project.connections[p.conn].from === p.from ? flowDownstream : -flowDownstream;
    }
  }
  return flows;
}

/** DC-симуляция проекта. Детали, перегруженные сверх порога, «перегорают» (обрыв), и схема пересчитывается. */
export function simulateDc(project: Project, board: BoardDef, state: SimState): SimResult {
  const ctx = new ErcContext(project, board);
  const failed = new Map<string, FailReason>();
  const failInfo = new Map<string, Stress>();
  let guess: number[] | undefined;
  let result!: ReturnType<typeof evaluate>;

  for (let round = 0; round <= project.parts.length; round++) {
    result = evaluate(project, board, ctx, state, new Set(failed.keys()), guess);
    guess = result.v;
    const worst = [...result.stresses.entries()]
      .filter(([id, s]) => !failed.has(id) && s.stress >= s.burnAt)
      .sort((a, b) => b[1].stress / b[1].burnAt - a[1].stress / a[1].burnAt)[0];
    if (!worst) break;
    failed.set(worst[0], worst[1].reason);
    failInfo.set(worst[0], worst[1]);
  }
  return finalize(project, board, ctx, result, failed, failInfo);
}

function evaluate(
  project: Project,
  board: BoardDef,
  ctx: ErcContext,
  state: SimState,
  failed: Set<string>,
  guess?: number[],
) {
  const netlist = buildNetlist(project, board, state, failed);
  const sol = solveDc(
    netlist.nNodes,
    netlist.items.map((x) => x.el),
    { initial: guess && guess.length === netlist.nNodes ? guess : undefined },
  );

  const pinI: Record<string, Record<string, number>> = {};
  for (const item of netlist.items) {
    const { i } = item.el.eval(item.el.nodes.map((k) => sol.v[k]));
    item.pins.forEach((pin, r) => {
      if (pin === null) return;
      const rec = (pinI[item.owner] ??= {});
      rec[pin] = (rec[pin] ?? 0) + i[r];
    });
  }
  const pinV = (ref: string, pin: string) => sol.v[netlist.pinNode(ref, pin)] ?? 0;

  const stresses = new Map<string, Stress>();
  for (const { inst, def } of ctx.knownParts()) {
    if (failed.has(inst.instanceId)) continue;
    const id = inst.instanceId;
    const I = (pin: string) => pinI[id]?.[pin] ?? 0;
    const V = (a: string, b: string) => pinV(id, a) - pinV(id, b);
    switch (def.kind) {
      case 'led':
      case 'diode': {
        const limit = ctx.param(def, 'ifMaxMa');
        const i = I('anode');
        const v = V('anode', 'cathode');
        stresses.set(id, {
          stress: limit ? (Math.max(i, 0) * 1000) / limit : 0,
          burnAt: def.kind === 'led' ? BURN.led : BURN.diode,
          reason: 'overcurrent',
          i,
          v,
          p: i * v,
        });
        break;
      }
      case 'resistor': {
        const r = ctx.ohms(ctx.ep(`${id}:1`));
        const i = I('1');
        const rated = ctx.param(def, 'powerW') ?? 0.25;
        const p = i * i * r;
        stresses.set(id, {
          stress: Number.isFinite(p) ? p / rated : 0,
          burnAt: BURN.resistor,
          reason: 'overpower',
          i,
          v: V('1', '2'),
          p,
        });
        break;
      }
      case 'npn': {
        const limit = ctx.param(def, 'icMaxMa');
        const i = I('C');
        stresses.set(id, {
          stress: limit ? (Math.max(i, 0) * 1000) / limit : 0,
          burnAt: BURN.npn,
          reason: 'overcurrent',
          i,
          v: V('C', 'E'),
          p: i * V('C', 'E'),
        });
        break;
      }
      case 'nmos': {
        const limit = ctx.param(def, 'idMaxMa');
        const i = I('D');
        stresses.set(id, {
          stress: limit ? (Math.abs(i) * 1000) / limit : 0,
          burnAt: BURN.nmos,
          reason: 'overcurrent',
          i,
          v: V('D', 'S'),
          p: Math.abs(i * V('D', 'S')),
        });
        break;
      }
      case 'button':
      case 'potentiometer':
        break;
      default: {
        // модули: перенапряжение питания
        const max = ctx.param(def, 'supplyMaxV');
        const sp = def.pins.find((p) => p.electrical === 'power_in');
        const gp = def.pins.find((p) => p.electrical === 'gnd');
        if (max && sp && gp) {
          const v = V(sp.id, gp.id);
          stresses.set(id, { stress: v / max, burnAt: BURN.supply, reason: 'overvoltage', v });
        }
      }
    }
  }
  return { netlist, sol, v: sol.v, pinI, pinV, stresses };
}

function finalize(
  project: Project,
  board: BoardDef,
  ctx: ErcContext,
  r: ReturnType<typeof evaluate>,
  failed: Map<string, FailReason>,
  failInfo: Map<string, Stress>,
): SimResult {
  const { netlist, sol, pinI, pinV, stresses } = r;
  const parts: Record<string, PartResult> = {};

  for (const { inst, def } of ctx.knownParts()) {
    const id = inst.instanceId;
    const pins = Object.fromEntries(
      def.pins.map((p) => [p.id, { v: pinV(id, p.id), i: pinI[id]?.[p.id] ?? 0 }]),
    );
    const s = stresses.get(id) ?? failInfo.get(id);
    let status: PartStatus = 'ok';
    const burnt = failed.get(id);
    if (burnt) status = 'burnt';
    else if (s && s.stress > 1) status = 'warn';
    else if (def.kind === 'led' || def.kind === 'diode' ? Math.abs(s?.i ?? 0) < 1e-6 : false)
      status = 'idle';
    // питание модуля ниже минимума
    const min = ctx.param(def, 'supplyMinV');
    const sp = def.pins.find((p) => p.electrical === 'power_in');
    const gp = def.pins.find((p) => p.electrical === 'gnd');
    if (!burnt && min && sp && gp && pinV(id, sp.id) - pinV(id, gp.id) < min * 0.9) status = 'off';
    if (
      burnt &&
      !(
        def.kind === 'led' ||
        def.kind === 'diode' ||
        def.kind === 'resistor' ||
        def.kind === 'npn' ||
        def.kind === 'nmos'
      )
    )
      status = 'burnt';

    const typ = (ctx.param(def, 'ifTypMa') ?? 10) / 1000;
    parts[id] = {
      id,
      kind: def.kind,
      status,
      ...(burnt && { reason: burnt }),
      ...(s ? { stress: s.stress, i: s.i, v: s.v, p: s.p } : { i: mainCurrent(def, pins) }),
      ...(def.kind === 'led' &&
        !burnt &&
        s?.i !== undefined && { glow: Math.max(0, Math.min(1.2, s.i / typ)) }),
      pins,
    };
  }

  const boardPins: Record<string, PinState> = {};
  const endpoints: Record<string, PinState> = {};
  for (const [ep, node] of netlist.nodeOfEndpoint) {
    const { ref, pinId } = ctx.ep(ep);
    const state = { v: sol.v[node] ?? 0, i: pinI[ref === 'board' ? 'board' : ref]?.[pinId] ?? 0 };
    endpoints[ep] = state;
    if (ref === 'board') boardPins[pinId] = state;
  }

  // GND платы: ток равен невязке остальных выводов цепи (все GND платы — одна земля)
  for (const net of ctx.nets.nets) {
    const gnds = ctx.netEps(net.id).filter((e) => e.isBoard && ctx.isGnd(e));
    if (!gnds.length) continue;
    const others = ctx.netEps(net.id).filter((e) => !gnds.includes(e));
    const residual = -others.reduce((s, e) => s + (endpoints[e.endpoint]?.i ?? 0), 0);
    gnds.forEach((g, k) => {
      if (endpoints[g.endpoint]) endpoints[g.endpoint].i = k === 0 ? residual : 0;
      if (boardPins[g.pinId]) boardPins[g.pinId].i = endpoints[g.endpoint]?.i ?? 0;
    });
  }

  const endpointI = Object.fromEntries(Object.entries(endpoints).map(([k, v]) => [k, v.i]));
  const flows = wireFlows(project, ctx, endpointI);
  const wires: WireResult[] = project.connections.map((c, idx) => ({
    i: flows[idx],
    v: endpoints[c.from]?.v ?? 0,
  }));

  const warnings: SimWarning[] = [];
  if (!sol.converged) warnings.push({ code: 'nonconverged', ref: 'solver', value: sol.iterations });
  for (const p of board.pins) {
    const st = boardPins[p.id];
    if (!st) continue;
    const mA = Math.abs(st.i) * 1000;
    if (p.functions.includes('gpio') && p.maxCurrentMa !== undefined && mA > p.maxCurrentMa)
      warnings.push({ code: 'pin_overcurrent', ref: p.id, value: mA, limit: p.maxCurrentMa });
    const rail = board.rails.find((x) => x.pinId === p.id);
    if (rail && mA > rail.maxCurrentMa)
      warnings.push({ code: 'rail_overload', ref: p.id, value: mA, limit: rail.maxCurrentMa });
    if (mA > 1000 && (rail || ctx.isSupplyPin(ctx.ep(`board:${p.id}`))))
      warnings.push({ code: 'short_circuit', ref: p.id, value: mA });
  }

  return {
    status: sol.singular ? 'singular' : sol.converged ? 'ok' : 'nonconverged',
    iterations: sol.iterations,
    parts,
    board: boardPins,
    endpoints,
    wires,
    failed: Object.fromEntries(failed),
    warnings,
  };
}

/** Основной ток детали без собственной модели стресса: катушка/мотор или суммарный ток по выводам питания. */
function mainCurrent(def: ComponentDef, pins: Record<string, PinState>): number | undefined {
  const coil = def.pins.find((p) => p.id === 'COIL+' || p.id === 'M+');
  if (coil) return pins[coil.id]?.i;
  const supplies = def.pins.filter((p) => p.electrical === 'power_in');
  return supplies.length ? supplies.reduce((sum, p) => sum + (pins[p.id]?.i ?? 0), 0) : undefined;
}

const RANK: Record<PartStatus, number> = { burnt: 5, warn: 4, ok: 3, off: 2, idle: 1 };
const lerp = (
  base: number | undefined,
  ons: { d: number; v: number | undefined }[],
): number | undefined => {
  if (base === undefined) return undefined;
  return ons.reduce((sum, { d, v }) => sum + d * ((v ?? base) - base), base);
};
const blendPin = (base: PinState, ons: { d: number; v: PinState | undefined }[]): PinState => ({
  v: lerp(
    base.v,
    ons.map(({ d, v }) => ({ d, v: v?.v })),
  )!,
  i: lerp(
    base.i,
    ons.map(({ d, v }) => ({ d, v: v?.i })),
  )!,
});

/**
 * DC-симуляция с учётом ШИМ. Пины в режиме `pwm` считаются независимыми каналами: результат — база (все ШИМ-пины LOW)
 * плюс сумма вкладов каналов, каждый из которых равен скважности × (результат при HIGH на этом пине − база).
 * Для светодиода это даёт среднюю яркость и средний ток, а не ток при «средней» нелинейной величине напряжения.
 */
export function simulate(
  project: Project,
  board: BoardDef,
  state: SimState = defaultSimState(project, board),
): SimResult {
  const pwm = Object.entries(state.gpio)
    .filter(([, mode]) => mode === 'pwm')
    .map(([pin]) => ({ pin, duty: Math.min(1, Math.max(0, state.duty?.[pin] ?? 0)) }));
  if (!pwm.length) return simulateDc(project, board, state);

  const asLow = Object.fromEntries(
    Object.entries(state.gpio).map(([p, m]) => [p, m === 'pwm' ? 'low' : m] as const),
  );
  const base = simulateDc(project, board, { ...state, gpio: asLow });
  const ons = pwm
    .filter((p) => p.duty > 0.005)
    .map((p) => ({
      d: p.duty,
      r: simulateDc(project, board, { ...state, gpio: { ...asLow, [p.pin]: 'high' } }),
    }));
  if (!ons.length) return base;

  const parts: Record<string, PartResult> = {};
  for (const [id, b] of Object.entries(base.parts)) {
    const at = ons.map(({ d, r }) => ({ d, r: r.parts[id] }));
    const status = [b, ...at.map((x) => x.r)].reduce<PartStatus>(
      (worst, x) => (x && RANK[x.status] > RANK[worst] ? x.status : worst),
      b.status,
    );
    const reason = at.find((x) => x.r?.status === 'burnt')?.r.reason ?? b.reason;
    parts[id] = {
      ...b,
      status,
      ...(reason && { reason }),
      i: lerp(
        b.i,
        at.map(({ d, r }) => ({ d, v: r?.i })),
      ),
      v: lerp(
        b.v,
        at.map(({ d, r }) => ({ d, v: r?.v })),
      ),
      p: lerp(
        b.p,
        at.map(({ d, r }) => ({ d, v: r?.p })),
      ),
      stress: lerp(
        b.stress,
        at.map(({ d, r }) => ({ d, v: r?.stress })),
      ),
      glow: lerp(
        b.glow,
        at.map(({ d, r }) => ({ d, v: r?.glow })),
      ),
      pins: Object.fromEntries(
        Object.entries(b.pins).map(([pin, st]) => [
          pin,
          blendPin(
            st,
            at.map(({ d, r }) => ({ d, v: r?.pins[pin] })),
          ),
        ]),
      ),
    };
  }
  const blendMap = (get: (r: SimResult) => Record<string, PinState>) =>
    Object.fromEntries(
      Object.entries(get(base)).map(([k, st]) => [
        k,
        blendPin(
          st,
          ons.map(({ d, r }) => ({ d, v: get(r)[k] })),
        ),
      ]),
    );

  const warnings = [...base.warnings];
  for (const { r } of ons)
    for (const w of r.warnings)
      if (!warnings.some((x) => x.code === w.code && x.ref === w.ref)) warnings.push(w);

  return {
    status: [base, ...ons.map((o) => o.r)].some((r) => r.status !== 'ok')
      ? [base, ...ons.map((o) => o.r)].find((r) => r.status !== 'ok')!.status
      : 'ok',
    iterations: Math.max(base.iterations, ...ons.map((o) => o.r.iterations)),
    parts,
    board: blendMap((r) => r.board),
    endpoints: blendMap((r) => r.endpoints),
    wires: base.wires.map((w, idx) => ({
      i: lerp(
        w.i,
        ons.map(({ d, r }) => ({ d, v: r.wires[idx]?.i })),
      )!,
      v: lerp(
        w.v,
        ons.map(({ d, r }) => ({ d, v: r.wires[idx]?.v })),
      )!,
    })),
    failed: Object.assign({}, base.failed, ...ons.map((o) => o.r.failed)),
    warnings,
  };
}
