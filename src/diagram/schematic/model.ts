import { computeNets, type Net } from '@/core/nets';
import { getComponent } from '@/core/library';
import {
  BOARD_REF,
  parseEndpoint,
  type BoardDef,
  type ComponentDef,
  type Project,
} from '@/core/schema';
import { formatOhms, parseOhms } from '@/core/units';
import { DISCRETE_KINDS, ELEM_LEN, SYMBOLS } from './symbols';

/**
 * Принципиальная схема, раскладка без маршрутизации: плата — блок слева, детали — справа.
 * Сигнальные цепи идут по вертикальным «дорожкам» между ними (у каждой цепи своя дорожка, у каждого вывода своя
 * строка), поэтому провода физически не накладываются. Питание и земля — условные знаки у выводов, а цепи, до
 * которых нельзя дотянуть проводом (вывод справа от детали), — метками с именем цепи.
 */

export const PITCH = 8; // шаг выводов, ед.
export const STUB = 8; // длина вывода блока
export const TRACK = 6; // шаг дорожек
export { ELEM_LEN };
const GROUP_GAP = 12;
const CHAR_W = 3.3; // ширина символа мелкого шрифта, ед.

export type NetClass = 'gnd' | 'power' | 'signal';

export interface Pt {
  x: number;
  y: number;
}
export interface SegmentWire {
  net: number;
  a: Pt;
  b: Pt;
}
export interface BlockPin {
  id: string;
  label: string;
  y: number;
  endpoint: string;
  connected: boolean;
}
export interface Block {
  ref: string;
  /** Ключ связи с каталогом (фото): "board:<id>" или "component:<id>". */
  linkKey?: string;
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Выводы справа (плата) или слева (детали). */
  side: 'left' | 'right';
  pins: BlockPin[];
  board: boolean;
}
export interface Element {
  ref: string;
  linkKey?: string;
  kind: string;
  x: number; // левый край (вывод)
  y: number; // ось
  rev: boolean; // полярность развёрнута
  label: string;
  value?: string;
}
export interface SymbolItem {
  ref: string;
  linkKey?: string;
  kind: string;
  x: number;
  y: number;
  label: string;
  value?: string;
}
export interface Mark {
  x: number;
  y: number;
  dir: 1 | -1;
  net: number;
  kind: NetClass;
  text: string;
  /** Метка цепи без проводов (kind="signal") или знак питания. */
  label: boolean;
}
export interface Schematic {
  width: number;
  height: number;
  blocks: Block[];
  elements: Element[];
  /** Многовыводные символы: транзисторы, потенциометр, реле. */
  symbols: SymbolItem[];
  wires: SegmentWire[];
  marks: Mark[];
  /** Короткие выводы (линии от блока до точки подключения). */
  stubs: SegmentWire[];
  /** Подписи цепей у выводов платы. */
  netNames: { x: number; y: number; text: string; dir: 1 | -1 }[];
  unknownRefs: string[];
}

const DISCRETE_PINS: Record<string, [string, string]> = {
  resistor: ['1', '2'],
  button: ['1', '2'],
  led: ['anode', 'cathode'],
  diode: ['anode', 'cathode'],
  zener: ['anode', 'cathode'],
  schottky: ['anode', 'cathode'],
  motor: ['M+', 'M-'],
};

function discretePins(def: ComponentDef | undefined): [string, string] | undefined {
  if (!def || def.pins.length !== 2 || !def.kind || !DISCRETE_KINDS.has(def.kind)) return undefined;
  const known = DISCRETE_PINS[def.kind];
  if (known && known.every((id) => def.pins.some((p) => p.id === id))) return known;
  return [def.pins[0].id, def.pins[1].id];
}

/** Составной символ (транзистор, потенциометр, реле), если у детали есть все нужные выводы. */
function symbolKind(def: ComponentDef | undefined): string | undefined {
  const spec = def?.kind ? SYMBOLS[def.kind] : undefined;
  if (!def || !def.kind || !spec) return undefined;
  return Object.keys(spec.terminals).every((id) => def.pins.some((p) => p.id === id))
    ? def.kind
    : undefined;
}

function classify(net: Net, board: BoardDef): NetClass {
  let power = false;
  for (const ep of net.endpoints) {
    const { ref, pin } = parseEndpoint(ep);
    if (ref !== BOARD_REF) continue;
    const def = board.pins.find((p) => p.id === pin);
    if (def?.functions.includes('gnd')) return 'gnd';
    if (def?.functions.includes('power')) power = true;
  }
  if (power) return 'power';
  if (/^(gnd|agnd|pgnd|0v)$/i.test(net.name)) return 'gnd';
  if (/^(vcc|vdd|vin|vbat|vusb|\+?\d+(\.\d+)?v\d*|\d+v\d+)$/i.test(net.name)) return 'power';
  return 'signal';
}

const textW = (s: string) => s.length * CHAR_W;

interface Terminal {
  endpoint: string;
  /** Положение конца вывода относительно группы (до раскладки по Y/X групп). */
  dx: number;
  dy: number;
  dir: 1 | -1;
  net: number;
  /** Внутреннее соединение цепочки — рисуется самим символами. */
  internal?: boolean;
}

interface Group {
  kind: 'block' | 'chain' | 'symbol';
  height: number;
  width: number;
  terminals: Terminal[];
  /** Для сортировки по высоте связанных выводов платы. */
  anchorY?: number;
  elements: Omit<Element, 'x' | 'y'>[];
  block?: Omit<Block, 'x' | 'y'>;
  pinOffsets?: number[];
  symbol?: Omit<SymbolItem, 'x' | 'y'>;
}

export function buildSchematic(project: Project, board: BoardDef): Schematic {
  const nets = computeNets(project);
  const cls = nets.nets.map((n) => classify(n, board));
  const netOf = (ep: string) => nets.netOfEndpoint.get(ep);
  const unknownRefs: string[] = [];

  // ───── плата ─────
  const boardOrder = (pinId: string) => {
    const ep = `${BOARD_REF}:${pinId}`;
    const n = netOf(ep);
    const c = n === undefined ? 'signal' : cls[n];
    return (
      (c === 'power' ? 0 : c === 'signal' ? 1 : 2) * 1000 +
      board.pins.findIndex((p) => p.id === pinId)
    );
  };
  const usedBoardPins = board.pins
    .filter((p) => netOf(`${BOARD_REF}:${p.id}`) !== undefined)
    .sort((a, b) => boardOrder(a.id) - boardOrder(b.id));
  const boardLabelW = Math.max(
    40,
    ...usedBoardPins.map((p) => textW(p.label || p.id) + 10),
    textW(board.name) + 10,
  );
  const boardPinY = (i: number) => 18 + i * PITCH;
  const boardH = 18 + Math.max(1, usedBoardPins.length) * PITCH + 4;
  const boardPinPos = new Map<string, Pt>();
  usedBoardPins.forEach((p, i) =>
    boardPinPos.set(`${BOARD_REF}:${p.id}`, { x: boardLabelW + STUB, y: boardPinY(i) }),
  );

  // ───── группы деталей ─────
  const byRef = new Map(project.parts.map((p) => [p.instanceId, p]));
  const discrete = new Map<string, [string, string]>();
  for (const part of project.parts) {
    const pins = discretePins(getComponent(part.componentId));
    if (pins) discrete.set(part.instanceId, pins);
  }

  // цепочки двухвыводных деталей: цепь ровно из двух выводов разных деталей, не питание
  const link = new Map<string, { other: string; net: number; a: string; b: string }[]>();
  nets.nets.forEach((n, ni) => {
    if (cls[ni] !== 'signal' || n.endpoints.length !== 2) return;
    const [e1, e2] = n.endpoints.map(parseEndpoint);
    if (e1.ref === e2.ref || !discrete.has(e1.ref) || !discrete.has(e2.ref)) return;
    for (const [x, y] of [
      [e1, e2],
      [e2, e1],
    ] as const) {
      const arr = link.get(x.ref) ?? [];
      arr.push({ other: y.ref, net: ni, a: x.pin, b: y.pin });
      link.set(x.ref, arr);
    }
  });
  const chainOf = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const ref of discrete.keys()) {
    if (seen.has(ref)) continue;
    // собираем компонент связности и проверяем, что это простой путь
    const comp: string[] = [];
    const stack = [ref];
    seen.add(ref);
    while (stack.length) {
      const r = stack.pop()!;
      comp.push(r);
      for (const l of link.get(r) ?? [])
        if (!seen.has(l.other)) {
          seen.add(l.other);
          stack.push(l.other);
        }
    }
    const simple = comp.every((r) => (link.get(r)?.length ?? 0) <= 2) && comp.length <= 4;
    if (simple && comp.length > 1) {
      const start = comp.find((r) => (link.get(r)?.length ?? 0) === 1) ?? comp[0];
      const order = [start];
      let prev = '';
      for (let cur = start; ;) {
        const next = (link.get(cur) ?? []).find(
          (l) => l.other !== prev && !order.includes(l.other),
        );
        if (!next) break;
        order.push(next.other);
        prev = cur;
        cur = next.other;
      }
      if (order.length === comp.length) {
        chainOf.set(start, order);
        continue;
      }
    }
    for (const r of comp) chainOf.set(r, [r]);
  }
  const inChain = new Set<string>();
  const groups: Group[] = [];

  const termNet = (ref: string, pin: string) => netOf(`${ref}:${pin}`);

  for (const [start, order] of chainOf) {
    if (order[0] !== start) continue;
    const refs = order;
    // ориентация цепочки: слева — вывод, подключённый к сигнальной цепи с другими выводами
    const firstPins = discrete.get(refs[0])!;
    const lastPins = discrete.get(refs[refs.length - 1])!;
    const outerA = refs.length === 1 ? firstPins[0] : termFree(refs, 0);
    const outerB = refs.length === 1 ? firstPins[1] : termFree(refs, 1);
    function termFree(rs: string[], end: 0 | 1): string {
      const r = end === 0 ? rs[0] : rs[rs.length - 1];
      const pins = discrete.get(r)!;
      // свободный вывод — тот, что не связан с соседом по цепочке
      const neighbour = link.get(r)?.find((l) => rs.includes(l.other));
      return neighbour ? (neighbour.a === pins[0] ? pins[1] : pins[0]) : pins[end === 0 ? 0 : 1];
    }
    void lastPins;
    const signalish = (ref: string, pin: string) => {
      const n = termNet(ref, pin);
      return n !== undefined && cls[n] === 'signal' && nets.nets[n].endpoints.length > 1;
    };
    const aSig = signalish(refs[0], outerA);
    const bSig = signalish(refs[refs.length - 1], outerB);
    const flipped = !aSig && bSig; // сигнальный конец — слева
    const seq = flipped ? [...refs].reverse() : refs;
    const elements: Group['elements'] = [];
    const terminals: Terminal[] = [];
    seq.forEach((r, i) => {
      inChain.add(r);
      const part = byRef.get(r)!;
      const def = getComponent(part.componentId)!;
      const [p1, p2] = discrete.get(r)!;
      // в какую сторону смотрит p1 внутри цепочки
      const prevRef = seq[i - 1];
      const nextRef = seq[i + 1];
      const joinsPrev = (pin: string) =>
        !!prevRef && !!link.get(r)?.some((l) => l.other === prevRef && l.a === pin);
      const joinsNext = (pin: string) =>
        !!nextRef && !!link.get(r)?.some((l) => l.other === nextRef && l.a === pin);
      let leftPin: string;
      if (seq.length === 1) leftPin = flipped ? p2 : outerPinLeft(r, p1, p2);
      else if (joinsPrev(p1) || joinsNext(p2)) leftPin = p1;
      else if (joinsPrev(p2) || joinsNext(p1)) leftPin = p2;
      else leftPin = (flipped ? outerB : outerA) === p1 ? p1 : p2;
      const rev = leftPin !== p1;
      elements.push({
        ref: r,
        linkKey: `component:${part.componentId}`,
        kind: def.kind ?? 'resistor',
        rev,
        label: r,
        value: elementValue(def, part.value),
      });
      const rightPin = rev ? p1 : p2;
      if (i === 0)
        terminals.push({
          endpoint: `${r}:${leftPin}`,
          dx: 0,
          dy: 0,
          dir: -1,
          net: termNet(r, leftPin) ?? -1,
        });
      if (i === seq.length - 1)
        terminals.push({
          endpoint: `${r}:${rightPin}`,
          dx: ELEM_LEN * seq.length,
          dy: 0,
          dir: 1,
          net: termNet(r, rightPin) ?? -1,
        });
    });
    function outerPinLeft(r: string, p1: string, p2: string): string {
      const s1 = signalish(r, p1);
      const s2 = signalish(r, p2);
      return s2 && !s1 ? p2 : p1;
    }
    groups.push({ kind: 'chain', height: 26, width: ELEM_LEN * seq.length, terminals, elements });
  }

  // составные символы: транзисторы, потенциометр, реле
  const inSymbol = new Set<string>();
  for (const part of project.parts) {
    if (inChain.has(part.instanceId)) continue;
    const def = getComponent(part.componentId);
    const kind = symbolKind(def);
    if (!kind) continue;
    const spec = SYMBOLS[kind];
    inSymbol.add(part.instanceId);
    const terminals: Terminal[] = Object.entries(spec.terminals)
      .filter(([pin]) => netOf(`${part.instanceId}:${pin}`) !== undefined)
      .map(([pin, [dx, dy, dir]]) => ({
        endpoint: `${part.instanceId}:${pin}`,
        dx,
        dy: dy + 9,
        dir,
        net: netOf(`${part.instanceId}:${pin}`)!,
      }));
    groups.push({
      kind: 'symbol',
      height: spec.h + 20,
      width: spec.w,
      terminals,
      elements: [],
      symbol: {
        ref: part.instanceId,
        linkKey: `component:${part.componentId}`,
        kind,
        label: part.instanceId,
        value: part.value,
      },
    });
  }

  // блоки: все остальные детали
  for (const part of project.parts) {
    if (inChain.has(part.instanceId) || inSymbol.has(part.instanceId)) continue;
    const def = getComponent(part.componentId);
    if (!def) unknownRefs.push(part.instanceId);
    const pinIds = def
      ? def.pins.map((p) => ({ id: p.id, label: p.label || p.id }))
      : [
          ...new Set(
            project.connections.flatMap((c) =>
              [c.from, c.to]
                .map(parseEndpoint)
                .filter((e) => e.ref === part.instanceId)
                .map((e) => e.pin),
            ),
          ),
        ].map((id) => ({ id, label: id }));
    const w = Math.max(
      44,
      ...pinIds.map((p) => textW(p.label) + 12),
      textW(part.instanceId + ' ' + (def?.name ?? '')) / 1.4 + 8,
    );
    const pins = pinIds.map((p, i) => ({
      id: p.id,
      label: p.label,
      y: 16 + i * PITCH,
      endpoint: `${part.instanceId}:${p.id}`,
      connected: netOf(`${part.instanceId}:${p.id}`) !== undefined,
    }));
    const terminals = pins
      .filter((p) => p.connected)
      .map<Terminal>((p) => ({
        endpoint: p.endpoint,
        dx: -STUB,
        dy: p.y,
        dir: -1,
        net: netOf(p.endpoint)!,
      }));
    groups.push({
      kind: 'block',
      height: 16 + pins.length * PITCH + 2,
      width: w,
      terminals,
      elements: [],
      block: {
        ref: part.instanceId,
        linkKey: `component:${part.componentId}`,
        title: part.instanceId,
        subtitle: def?.name,
        w,
        h: 16 + pins.length * PITCH + 2,
        side: 'left',
        pins,
        board: false,
      },
    });
  }

  // ───── какие цепи можно вести проводом ─────
  // проводом — только если все выводы смотрят на дорожки: вывод платы (вправо) и левые выводы деталей
  const endpointDir = new Map<string, 1 | -1>();
  const internalEnds = new Set<string>();
  for (const [ep] of boardPinPos) endpointDir.set(ep, 1);
  for (const g of groups) for (const t of g.terminals) endpointDir.set(t.endpoint, t.dir);
  const wireable = nets.nets.map((n, ni) => {
    if (cls[ni] !== 'signal') return false;
    const real = n.endpoints.filter((e) => !internalEnds.has(e));
    if (real.length < 2) return false;
    return (
      real.every((e) => endpointDir.get(e) !== undefined) &&
      real.every((e) => {
        const { ref } = parseEndpoint(e);
        return ref === BOARD_REF || endpointDir.get(e) === -1;
      }) &&
      real.some((e) => parseEndpoint(e).ref === BOARD_REF || true)
    );
  });
  // внутренние соединения цепочек (цепь из двух выводов соседних деталей) не требуют проводов
  nets.nets.forEach((n, ni) => {
    if (n.endpoints.length !== 2) return;
    const [e1, e2] = n.endpoints;
    const r1 = parseEndpoint(e1).ref;
    const r2 = parseEndpoint(e2).ref;
    for (const g of groups) {
      if (g.kind !== 'chain' || g.elements.length < 2) continue;
      const refs = g.elements.map((e) => e.ref);
      if (refs.includes(r1) && refs.includes(r2)) {
        wireable[ni] = false;
        internalEnds.add(e1);
        internalEnds.add(e2);
      }
    }
  });

  // ───── порядок групп по высоте связанных выводов платы ─────
  for (const g of groups) {
    const ys: number[] = [];
    for (const t of g.terminals) {
      if (t.net < 0 || !wireable[t.net]) continue;
      for (const e of nets.nets[t.net].endpoints) {
        const p = boardPinPos.get(e);
        if (p) ys.push(p.y);
      }
    }
    g.anchorY = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity;
  }
  const ordered = [...groups].sort((a, b) => (a.anchorY ?? Infinity) - (b.anchorY ?? Infinity));

  // ───── координаты ─────
  const wiredNets = nets.nets.map((_, i) => i).filter((i) => wireable[i]);
  const netLabelW = Math.max(
    0,
    ...usedBoardPins.map((p) => {
      const n = netOf(`${BOARD_REF}:${p.id}`);
      return n === undefined ? 0 : textW(nets.nets[n].name) + 4;
    }),
  );
  const boardRight = boardLabelW;
  const tracksX0 = boardRight + STUB + Math.max(14, netLabelW + 8);
  const partsX0 = tracksX0 + wiredNets.length * TRACK + 14;

  let cursor = 0;
  const blocks: Block[] = [];
  const elements: Element[] = [];
  const symbols: SymbolItem[] = [];
  const terminalPos = new Map<string, Pt & { dir: 1 | -1 }>();
  for (const [ep, p] of boardPinPos) terminalPos.set(ep, { ...p, dir: 1 });
  for (const g of ordered) {
    const top = cursor;
    if (g.kind === 'block' && g.block) {
      const x = partsX0 + STUB;
      blocks.push({ ...g.block, x, y: top });
      for (const t of g.terminals)
        terminalPos.set(t.endpoint, { x: x - STUB, y: top + t.dy, dir: -1 });
    } else if (g.kind === 'symbol' && g.symbol) {
      const x = partsX0 + STUB;
      symbols.push({ ...g.symbol, x, y: top + 9 });
      for (const t of g.terminals)
        terminalPos.set(t.endpoint, { x: x + t.dx, y: top + t.dy, dir: t.dir });
    } else {
      const y = top + 13;
      g.elements.forEach((e, i) => elements.push({ ...e, x: partsX0 + i * ELEM_LEN, y }));
      for (const t of g.terminals)
        terminalPos.set(t.endpoint, { x: partsX0 + t.dx, y, dir: t.dir });
    }
    cursor += g.height + GROUP_GAP;
  }

  // ───── провода: у каждой цепи своя вертикальная дорожка ─────
  const wiredOrder = [...wiredNets].sort((a, b) => meanY(a) - meanY(b));
  function meanY(ni: number): number {
    const ys = nets.nets[ni].endpoints.map((e) => terminalPos.get(e)?.y ?? 0);
    return ys.reduce((s, y) => s + y, 0) / Math.max(1, ys.length);
  }
  const wires: SegmentWire[] = [];
  wiredOrder.forEach((ni, k) => {
    const x = tracksX0 + k * TRACK;
    const ends = nets.nets[ni].endpoints
      .map((e) => terminalPos.get(e))
      .filter((p): p is Pt & { dir: 1 | -1 } => !!p);
    for (const p of ends) wires.push({ net: ni, a: { x: p.x, y: p.y }, b: { x, y: p.y } });
    const ys = ends.map((p) => p.y);
    if (Math.min(...ys) !== Math.max(...ys))
      wires.push({ net: ni, a: { x, y: Math.min(...ys) }, b: { x, y: Math.max(...ys) } });
  });

  // ───── платa, выводы, знаки питания и метки ─────
  const boardBlock: Block = {
    ref: 'board',
    linkKey: `board:${board.id}`,
    title: board.name,
    x: 0,
    y: 0,
    w: boardLabelW,
    h: boardH,
    side: 'right',
    board: true,
    pins: usedBoardPins.map((p, i) => ({
      id: p.id,
      label: p.label || p.id,
      y: boardPinY(i),
      endpoint: `${BOARD_REF}:${p.id}`,
      connected: true,
    })),
  };
  blocks.unshift(boardBlock);

  const stubs: SegmentWire[] = [];
  const marks: Mark[] = [];
  const netNames: Schematic['netNames'] = [];
  for (const [ep, pos] of terminalPos) {
    const ni = netOf(ep);
    if (ni === undefined) continue;
    const isBoardPin = ep.startsWith(`${BOARD_REF}:`);
    const isBlockPin = !isBoardPin && blocks.some((b) => b.ref === parseEndpoint(ep).ref);
    // вывод блока: линия от корпуса до точки подключения
    if (isBoardPin)
      stubs.push({ net: ni, a: { x: boardRight, y: pos.y }, b: { x: pos.x, y: pos.y } });
    else if (isBlockPin)
      stubs.push({ net: ni, a: { x: pos.x + STUB, y: pos.y }, b: { x: pos.x, y: pos.y } });
    if (internalEnds.has(ep)) continue;
    const c = cls[ni];
    if (c !== 'signal') {
      marks.push({
        x: pos.x,
        y: pos.y,
        dir: pos.dir,
        net: ni,
        kind: c,
        text: nets.nets[ni].name,
        label: false,
      });
    } else if (!wireable[ni]) {
      marks.push({
        x: pos.x,
        y: pos.y,
        dir: pos.dir,
        net: ni,
        kind: 'signal',
        text: nets.nets[ni].name,
        label: true,
      });
    } else if (isBoardPin) {
      netNames.push({ x: pos.x - STUB + 2, y: pos.y - 1.6, text: nets.nets[ni].name, dir: 1 });
    }
  }

  const extentX = Math.max(
    ...blocks.map((b) => b.x + b.w),
    ...elements.map((e) => e.x + ELEM_LEN),
    ...symbols.map((s) => s.x + SYMBOLS[s.kind].w),
    ...marks.map((m) => m.x + m.dir * (6 + textW(m.text))),
    0,
  );
  const extentY = Math.max(boardH, cursor - GROUP_GAP, 0);
  void byRef;
  return {
    width: extentX + 24,
    height: extentY + 8,
    blocks,
    elements,
    symbols,
    wires,
    marks,
    stubs,
    netNames,
    unknownRefs,
  };
}

function elementValue(def: ComponentDef, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (def.kind === 'resistor') {
    const ohms = parseOhms(value);
    return Number.isFinite(ohms) ? formatOhms(ohms) : value;
  }
  return value;
}
