import { ErcContext, type Ep } from '../erc/context';
import type { BoardDef, Language, Project } from '../schema';

export type PinRole =
  | 'output'
  | 'input'
  | 'input_pullup'
  | 'analog_in'
  | 'pwm'
  | 'bidirectional'
  | 'i2c_sda'
  | 'i2c_scl'
  | 'spi'
  | 'uart';

export interface PinBinding {
  /** Имя константы в прошивке: LED, BUTTON, DHT_DATA... */
  name: string;
  /** Пин платы по библиотеке: "GPIO18", "D13", "GP4". */
  boardPin: string;
  /** Подключённые выводы других деталей, например "led1:anode" (через резистор — конец цепочки). */
  peers: string[];
  role: PinRole;
  /** Человекочитаемое описание для комментария. */
  description: string;
}

const NUM = (s: string) => Number(s);

/** Выражение пина в коде для языка; undefined — для этого сочетания плата/язык номер неизвестен. */
export function pinExpr(boardPin: string, language: Language): string | undefined {
  let m: RegExpExecArray | null;
  if ((m = /^D(\d+)$/.exec(boardPin)))
    return language === 'arduino' ? String(NUM(m[1])) : undefined;
  if ((m = /^A(\d+)$/.exec(boardPin))) return language === 'arduino' ? `A${m[1]}` : undefined;
  if ((m = /^GPIO(\d+)$/.exec(boardPin))) {
    if (language === 'esp-idf') return `GPIO_NUM_${m[1]}`;
    if (language === 'circuitpython') return `board.IO${m[1]}`;
    return String(NUM(m[1])); // Arduino-ESP32, MicroPython, Python (BCM)
  }
  if ((m = /^GP(\d+)$/.exec(boardPin))) {
    if (language === 'circuitpython') return `board.GP${m[1]}`;
    if (language === 'esp-idf') return undefined;
    return String(NUM(m[1]));
  }
  return undefined;
}

const toConst = (s: string) =>
  s
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .replace(/^(\d)/, '_$1') || 'PIN';

/** Конечные устройства за цепью пина: идём через резисторы к первой «настоящей» детали. */
function peerEndpoints(ctx: ErcContext, boardEp: Ep): Ep[] {
  const out: Ep[] = [];
  const seen = new Set<number>();
  const walk = (netId: number | undefined, from: string) => {
    if (netId === undefined || seen.has(netId)) return;
    seen.add(netId);
    for (const e of ctx.netEps(netId)) {
      if (e.endpoint === from || e.isBoard) continue;
      if (e.def?.kind === 'resistor') {
        const o = ctx.otherPin(e);
        if (o?.netId !== undefined && !ctx.isRail(o.netId)) walk(o.netId, o.endpoint);
        continue;
      }
      out.push(e);
    }
  };
  walk(boardEp.netId, boardEp.endpoint);
  return out;
}

function inferRole(boardEp: Ep, peers: Ep[], ctx: ErcContext): PinRole {
  const fns = new Set(peers.flatMap((p) => p.pin?.functions ?? []));
  if (fns.has('i2c_sda')) return 'i2c_sda';
  if (fns.has('i2c_scl')) return 'i2c_scl';
  if ([...fns].some((f) => f.startsWith('spi_'))) return 'spi';
  if ([...fns].some((f) => f.startsWith('uart_'))) return 'uart';
  if (peers.some((p) => p.def?.kind === 'button')) return 'input_pullup';
  if (peers.some((p) => p.pin?.analog)) return 'analog_in';
  if (peers.some((p) => p.pin?.functions.includes('pwm'))) return 'pwm';
  if (peers.some((p) => p.pin?.electrical === 'bidirectional')) return 'bidirectional';
  if (peers.some((p) => p.pin?.electrical === 'output')) return 'input';
  const v = ctx.signalVoltage(boardEp) ?? 0;
  return ctx.netLoad(boardEp.netId!, v, boardEp.endpoint).loadMa > 0 ||
    peers.some((p) => p.pin?.electrical === 'input' || p.def?.kind === 'led')
    ? 'output'
    : 'input';
}

/**
 * Детерминированная карта пинов проекта: имена констант, роли, подключённые детали.
 * Имена берутся из codeHints.pinMap (по пину платы), иначе строятся из подключённой детали.
 */
export function buildPinBindings(project: Project, board: BoardDef): PinBinding[] {
  const ctx = new ErcContext(project, board);
  const hinted = new Map<string, string>();
  for (const [name, pin] of Object.entries(project.codeHints?.pinMap ?? {}))
    hinted.set(pin, toConst(name));

  const used = new Set<string>();
  const unique = (base: string) => {
    let n = base;
    for (let i = 2; used.has(n); i++) n = `${base}_${i}`;
    used.add(n);
    return n;
  };

  const bindings: PinBinding[] = [];
  const order = new Map(board.pins.map((p, i) => [p.id, i]));
  const boardEps = ctx.nets.nets
    .flatMap((n) => ctx.netEps(n.id))
    .filter(
      (e) =>
        e.isBoard &&
        e.pin &&
        !ctx.isGnd(e) &&
        !ctx.isSupplyPin(e) &&
        e.pin.functions.includes('gpio') === true,
    );
  boardEps.sort((a, b) => (order.get(a.pinId) ?? 0) - (order.get(b.pinId) ?? 0));

  for (const ep of boardEps) {
    const peers = peerEndpoints(ctx, ep);
    const role = inferRole(ep, peers, ctx);
    const first = peers[0];
    const derived = first
      ? `${first.ref}${first.def?.kind === 'led' || first.def?.kind === 'button' ? '' : `_${first.pinId}`}`
      : ep.pinId;
    const name = unique(hinted.get(ep.pinId) ?? toConst(derived));
    bindings.push({
      name,
      boardPin: ep.pinId,
      peers: peers.map((p) => p.endpoint),
      role,
      description: peers.length
        ? peers.map((p) => `${p.ref}.${p.pin?.label ?? p.pinId}`).join(', ')
        : ep.pin!.label,
    });
  }
  return bindings;
}

export const PIN_BLOCK_START = 'CircuitMind pins (generated, do not edit)';
export const PIN_BLOCK_END = 'end of generated pins';

const COMMENT: Record<Language, string> = {
  arduino: '//',
  'esp-idf': '//',
  micropython: '#',
  circuitpython: '#',
  python: '#',
};

/** Блок констант с пинами. Находится в начале файла между маркерами; именно он гарантирует соответствие схеме. */
export function buildPreamble(bindings: PinBinding[], language: Language, board: BoardDef): string {
  const c = COMMENT[language];
  const lines = [`${c} ==== ${PIN_BLOCK_START} ====`, `${c} Board: ${board.name}`];
  for (const b of bindings) {
    const expr = pinExpr(b.boardPin, language);
    const note = `${c} ${b.boardPin} → ${b.description} (${b.role})`;
    if (expr === undefined) {
      lines.push(
        `${note}`,
        `${c} ${b.name}: no pin number for this board/language — ${b.boardPin}`,
      );
      continue;
    }
    lines.push(note);
    if (language === 'arduino')
      lines.push(`constexpr auto ${b.name} = ${/^\d+$/.test(expr) ? `uint8_t(${expr})` : expr};`);
    else if (language === 'esp-idf') lines.push(`#define ${b.name} ${expr}`);
    else lines.push(`${b.name} = ${expr}`);
  }
  lines.push(`${c} ==== ${PIN_BLOCK_END} ====`);
  return lines.join('\n') + '\n';
}

/** Полный файл: преамбула + тело. Тело не должно повторять блок пинов. */
export const composeFirmware = (preamble: string, body: string): string =>
  `${preamble}\n${body.replace(/^\s*\n/, '').trimEnd()}\n`;
