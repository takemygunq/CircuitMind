import { ErcContext, type Ep } from '../erc/context';
import type { BoardDef, ComponentDef, PartInstance, Project } from '../schema';
import { type Element, resistor, theveninToGround } from './mna';
import { bjtEval, diodeEval, diodeFromPoint, nmosEval, nmosFromRds } from './models';

/** pwm: быстро переключаемый выход со скважностью `SimState.duty[пин]` (учитывается в `simulate`; в одиночном расчёте считается LOW). */
export type GpioMode = 'hiz' | 'low' | 'high' | 'pullup' | 'pwm';

/** Состояние, которым управляет пользователь: что делают пины МК, кнопки и потенциометры. */
export interface SimState {
  gpio: Record<string, GpioMode>;
  pressed: Record<string, boolean>;
  pots: Record<string, number>;
  /** Скважность 0..1 для пинов в режиме pwm. */
  duty?: Record<string, number>;
}

/** Параметры внешних источников. */
export const RAIL_OHMS = 0.3; // выход стабилизатора платы
export const GPIO_OHMS = 25; // выходное сопротивление пина МК
export const PULLUP_OHMS = 45_000; // внутренняя подтяжка
const SWITCH_ON_OHMS = 0.02;
const SWITCH_OFF_OHMS = 1e9;

export interface BuiltItem {
  el: Element;
  /** Владелец: instanceId детали или "board". */
  owner: string;
  /** Какому выводу владельца соответствует каждый терминал элемента (null — внутренний узел). */
  pins: (string | null)[];
}

export interface Netlist {
  nNodes: number;
  items: BuiltItem[];
  /** Узел каждого подключённого вывода: "ref:pin" → индекс узла. */
  nodeOfEndpoint: Map<string, number>;
  /** Узел вывода детали (в т.ч. неподключённого — тогда уникальный «плавающий» узел). */
  pinNode(ref: string, pin: string): number;
}

/** Состояния по умолчанию: пин, питающий нагрузку, — HIGH; кнопка на пине — подтяжка; остальное — вход без подтяжки. */
export function defaultSimState(project: Project, board: BoardDef): SimState {
  const ctx = new ErcContext(project, board);
  const gpio: Record<string, GpioMode> = {};
  for (const net of ctx.nets.nets)
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
      const eps = ctx.netEps(net.id);
      const hasButton = eps.some((e) => e.def?.kind === 'button');
      // шина I²C в покое подтянута к питанию
      const isI2c = eps.some(
        (e) => !e.isBoard && e.pin?.functions.some((f) => f === 'i2c_sda' || f === 'i2c_scl'),
      );
      const inductive = eps.some((e) => !e.isBoard && ctx.param(e.def, 'inductive'));
      const drives =
        inductive ||
        ctx.netLoad(net.id, v, bp.endpoint).loadMa > 0 ||
        eps.some(
          (e) =>
            !e.isBoard &&
            e.pin?.electrical === 'input' &&
            !e.pin.analog &&
            !e.pin.functions.some((f) => f === 'i2c_scl') &&
            e.def?.kind !== 'button',
        );
      gpio[bp.pin!.id] = hasButton || isI2c ? 'pullup' : drives ? 'high' : 'hiz';
    }
  return { gpio, pressed: {}, pots: {} };
}

const num = (ctx: ErcContext, def: ComponentDef, key: string, fallback: number) =>
  ctx.param(def, key) ?? fallback;

/**
 * Собирает электрическую модель проекта. Каждая цепь (узлы, склеенные проводами) — один узел; все GND платы — земля.
 * `failed` — детали, вышедшие из строя: они исключаются из схемы (обрыв).
 */
export function buildNetlist(
  project: Project,
  board: BoardDef,
  state: SimState,
  failed: ReadonlySet<string> = new Set(),
): Netlist {
  const ctx = new ErcContext(project, board);
  const nodeOfNet = new Map<number, number>();
  const nodeOfEndpoint = new Map<string, number>();
  const floating = new Map<string, number>();
  let next = 1;

  const groundNets = new Set<number>();
  for (const net of ctx.nets.nets)
    if (ctx.netEps(net.id).some((e) => e.isBoard && ctx.isGnd(e))) groundNets.add(net.id);

  const pinNode = (ref: string, pin: string): number => {
    const net = ctx.netOf(ref, pin);
    if (net !== undefined) {
      if (groundNets.has(net)) return 0;
      let n = nodeOfNet.get(net);
      if (n === undefined) nodeOfNet.set(net, (n = next++));
      return n;
    }
    const key = `${ref}:${pin}`;
    let n = floating.get(key);
    if (n === undefined) floating.set(key, (n = next++));
    return n;
  };

  const items: BuiltItem[] = [];
  const add = (el: Element, owner: string, pins: (string | null)[]) =>
    items.push({ el, owner, pins });

  // источники платы: питание, состояние пинов GPIO
  for (const net of ctx.nets.nets)
    for (const e of ctx.netEps(net.id).filter((e) => e.isBoard && e.pin)) {
      const node = pinNode('board', e.pinId);
      nodeOfEndpoint.set(e.endpoint, node);
      if (ctx.isGnd(e)) continue;
      if (ctx.isSupplyPin(e)) {
        const v = ctx.supplyVoltage(e);
        if (v !== undefined) add(theveninToGround(node, v, RAIL_OHMS), 'board', [e.pinId]);
      } else if (e.pin!.functions.includes('gpio')) {
        const mode = state.gpio[e.pinId] ?? 'hiz';
        const vHigh = ctx.signalVoltage(e) ?? board.logicVoltage;
        if (mode === 'high') add(theveninToGround(node, vHigh, GPIO_OHMS), 'board', [e.pinId]);
        else if (mode === 'low' || mode === 'pwm')
          add(theveninToGround(node, 0, GPIO_OHMS), 'board', [e.pinId]);
        else if (mode === 'pullup')
          add(theveninToGround(node, vHigh, PULLUP_OHMS), 'board', [e.pinId]);
      }
    }

  for (const { inst, def } of ctx.knownParts()) {
    for (const p of def.pins)
      nodeOfEndpointIfConnected(ctx, inst.instanceId, p.id, nodeOfEndpoint, pinNode);
    if (failed.has(inst.instanceId)) continue;
    modelPart(ctx, inst, def, state, pinNode, add);
  }

  return { nNodes: next, items, nodeOfEndpoint, pinNode };
}

function nodeOfEndpointIfConnected(
  ctx: ErcContext,
  ref: string,
  pin: string,
  map: Map<string, number>,
  pinNode: (r: string, p: string) => number,
): void {
  if (ctx.netOf(ref, pin) !== undefined) map.set(`${ref}:${pin}`, pinNode(ref, pin));
}

function modelPart(
  ctx: ErcContext,
  inst: PartInstance,
  def: ComponentDef,
  state: SimState,
  pinNode: (ref: string, pin: string) => number,
  add: (el: Element, owner: string, pins: (string | null)[]) => void,
): void {
  const id = inst.instanceId;
  const n = (pin: string) => pinNode(id, pin);
  switch (def.kind) {
    case 'resistor': {
      const ohms = ctx.ohms(ctx.ep(`${id}:1`));
      if (Number.isFinite(ohms) && ohms > 0) add(resistor(n('1'), n('2'), ohms), id, ['1', '2']);
      return;
    }
    case 'led':
    case 'diode': {
      const isLed = def.kind === 'led';
      const vf = num(ctx, def, 'vfV', isLed ? 2 : 1);
      const iRef = (isLed ? num(ctx, def, 'ifTypMa', 10) : num(ctx, def, 'ifMaxMa', 1000)) / 1000;
      const p = diodeFromPoint(vf, iRef, isLed ? 2 : 1.8);
      add(
        {
          nodes: [n('anode'), n('cathode')],
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
        },
        id,
        ['anode', 'cathode'],
      );
      return;
    }
    case 'npn': {
      const bf = num(ctx, def, 'hfeMin', 100) * 1.5;
      const p = { is: 1e-14, bf, br: 2 };
      add(
        {
          nodes: [n('C'), n('B'), n('E')],
          eval: ([vc, vb, ve]) => {
            const r = bjtEval(vc, vb, ve, p);
            return { i: r.i, J: r.J };
          },
        },
        id,
        ['C', 'B', 'E'],
      );
      return;
    }
    case 'nmos': {
      const vth = (num(ctx, def, 'vgsThMinV', 1) + num(ctx, def, 'vgsThMaxV', 2)) / 2;
      const p = nmosFromRds(num(ctx, def, 'rdsOnOhm5V', 0.05), 5, vth);
      add(
        {
          nodes: [n('D'), n('G'), n('S')],
          eval: ([vd, vg, vs]) => {
            const r = nmosEval(vd, vg, vs, p);
            return { i: r.i, J: r.J };
          },
        },
        id,
        ['D', 'G', 'S'],
      );
      return;
    }
    case 'button': {
      add(resistor(n('1'), n('2'), state.pressed[id] ? SWITCH_ON_OHMS : SWITCH_OFF_OHMS), id, [
        '1',
        '2',
      ]);
      return;
    }
    case 'potentiometer': {
      const total = num(ctx, def, 'resistanceOhm', 10_000);
      const pos = Math.min(0.999, Math.max(0.001, state.pots[id] ?? 0.5));
      add(resistor(n('1'), n('wiper'), total * pos), id, ['1', 'wiper']);
      add(resistor(n('wiper'), n('3'), total * (1 - pos)), id, ['wiper', '3']);
      return;
    }
    default:
      loadModel(ctx, inst, def, n, add);
  }
}

/** Прочие детали — потребители: ток из паспорта между выводами питания и землёй. */
function loadModel(
  ctx: ErcContext,
  inst: PartInstance,
  def: ComponentDef,
  n: (pin: string) => number,
  add: (el: Element, owner: string, pins: (string | null)[]) => void,
): void {
  const id = inst.instanceId;
  const gnd = def.pins.find((p) => p.electrical === 'gnd');
  const min = ctx.param(def, 'supplyMinV');
  const max = ctx.param(def, 'supplyMaxV');
  const nominal = min !== undefined && max !== undefined ? (min + max) / 2 : (max ?? min ?? 5);

  // катушки и моторы: сопротивление обмотки
  const coil = def.pins.filter((p) => /^(M[+-]|COIL[+-])$/.test(p.id));
  if (coil.length === 2) {
    const coilV = ctx.param(def, 'coilVoltageV') ?? nominal;
    const ma = ctx.supplyMa(def);
    if (ma > 0)
      add(resistor(n(coil[0].id), n(coil[1].id), coilV / (ma / 1000)), id, [
        coil[0].id,
        coil[1].id,
      ]);
    return;
  }
  const supplies = def.pins.filter((p) => p.electrical === 'power_in');
  const ma = ctx.supplyMa(def);
  if (!gnd || !supplies.length || ma <= 0) return;
  // Модули (МК-платы, датчики, дисплеи) потребляют почти постоянный ток, пока питание выше минимума; ниже — ток падает.
  const vmin = min ?? nominal * 0.6;
  for (const sp of supplies)
    add(currentSink(n(sp.id), n(gnd.id), ma / supplies.length / 1000, vmin), id, [sp.id, gnd.id]);
}

/** Потребитель постоянного тока i0 при напряжении ≥ vmin; ниже vmin ток линейно уменьшается до нуля. */
export function currentSink(a: number, b: number, i0: number, vmin: number): Element {
  const leak = 1e-9;
  return {
    nodes: [a, b],
    eval: ([va, vb]) => {
      const vd = va - vb;
      const slope = vd > 0 && vd < vmin ? i0 / vmin : 0;
      const i = vd <= 0 ? 0 : vd >= vmin ? i0 : slope * vd;
      const g = slope + leak;
      return {
        i: [i + leak * vd, -i - leak * vd],
        J: [
          [g, -g],
          [-g, g],
        ],
      };
    },
  };
}

export type { Ep };
