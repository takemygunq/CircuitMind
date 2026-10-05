import {
  BOARD_REF,
  parseEndpoint,
  type BoardDef,
  type PinDef,
  type Point,
  type Project,
} from '@/core/schema';
import type { Net, NetMap } from '@/core/nets';
import { boardPinExit, boardPinStub, boardRect, partObstacle, type PlacedPart } from './layout';
import { wireColor } from './colors';
import { nudgeRoutes, routeWire, STUB, type Pt, type Rect } from './routing';

export interface ResolvedEndpoint {
  endpoint: string;
  ref: string;
  pinId: string;
  /** Человекочитаемое имя владельца: "ESP32 DevKit V1" или "DHT22 (dht1)". */
  owner: string;
  pin: PinDef | undefined;
  part: PlacedPart | undefined;
  position: Point | undefined;
  exit: { dx: number; dy: number };
}

export function resolveEndpoint(
  endpoint: string,
  board: BoardDef,
  placed: ReadonlyMap<string, PlacedPart>,
): ResolvedEndpoint {
  const { ref, pin: pinId } = parseEndpoint(endpoint);
  if (ref === BOARD_REF) {
    const pin = board.pins.find((p) => p.id === pinId);
    return {
      endpoint,
      ref,
      pinId,
      owner: board.name,
      pin,
      part: undefined,
      position: pin?.position,
      exit: pin ? boardPinExit(board, pin.position) : { dx: 0, dy: -1 },
    };
  }
  const part = placed.get(ref);
  const pin = part?.def?.pins.find((p) => p.id === pinId);
  const position =
    pin && part
      ? { x: part.position.x + pin.position.x, y: part.position.y + pin.position.y }
      : undefined;
  return {
    endpoint,
    ref,
    pinId,
    owner: part?.def ? `${part.def.name} (${ref})` : ref,
    pin,
    part,
    position,
    exit: part?.art?.exits[pinId] ?? { dx: 0, dy: -1 },
  };
}

export interface WireGeometry {
  index: number;
  points: Pt[];
  color: string;
  netId: number;
  from: ResolvedEndpoint;
  to: ResolvedEndpoint;
}

/** Маршруты всех проводов проекта с учётом корпусов платы и деталей как препятствий. */
export function computeWires(
  project: Project,
  board: BoardDef,
  placed: PlacedPart[],
  nets: NetMap,
): WireGeometry[] {
  const byId = new Map(placed.map((p) => [p.part.instanceId, p]));
  const obstacles: Rect[] = [
    boardRect(board),
    ...placed.map(partObstacle).filter((r): r is Rect => !!r),
  ];
  const out: WireGeometry[] = [];
  const stubOf = (e: ResolvedEndpoint) =>
    e.ref === BOARD_REF && e.position ? boardPinStub(board, e.position, e.exit) : STUB;
  project.connections.forEach((conn, index) => {
    const from = resolveEndpoint(conn.from, board, byId);
    const to = resolveEndpoint(conn.to, board, byId);
    if (!from.position || !to.position) return;
    const netId = nets.netOfConnection[index];
    const points = routeWire(
      from.position,
      from.exit,
      to.position,
      to.exit,
      obstacles,
      index,
      stubOf(from),
      stubOf(to),
    );
    out.push({
      index,
      points,
      color: wireColor(conn, [from.pin, to.pin]),
      netId,
      from,
      to,
    });
  });
  // провода разных цепей не должны идти друг по другу: разводим параллельные участки по дорожкам
  const nudged = nudgeRoutes(
    out.map((w) => ({ points: w.points, net: w.netId })),
    obstacles,
  );
  return out.map((w, i) => ({ ...w, points: nudged[i].points }));
}

/** Напряжение цепи по первому пину питания/земли с известным напряжением. */
export function netVoltage(
  net: Net,
  board: BoardDef,
  placed: ReadonlyMap<string, PlacedPart>,
): number | undefined {
  for (const ep of net.endpoints) {
    const { pin } = resolveEndpoint(ep, board, placed);
    if (
      pin &&
      pin.voltage !== undefined &&
      (pin.functions.includes('gnd') ||
        pin.electrical === 'power_out' ||
        pin.functions.includes('power'))
    )
      return pin.voltage;
  }
  return undefined;
}

/** Для каждого пина платы: с какими точками других устройств он соединён (через общую цепь). */
export function boardPinUsage(nets: NetMap): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const net of nets.nets) {
    const boardPins = net.endpoints.filter((e) => parseEndpoint(e).ref === BOARD_REF);
    const others = net.endpoints.filter((e) => parseEndpoint(e).ref !== BOARD_REF);
    for (const bp of boardPins) usage.set(parseEndpoint(bp).pin, others);
  }
  return usage;
}

/** Другие точки той же цепи для любого endpoint. */
export function peersOf(endpoint: string, nets: NetMap): string[] {
  const id = nets.netOfEndpoint.get(endpoint);
  if (id === undefined) return [];
  return nets.nets[id].endpoints.filter((e) => e !== endpoint);
}
