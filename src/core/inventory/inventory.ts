import { z } from 'zod';
import { bomKey, deriveBom, type BomLine } from '../bom';
import { findCataloguePart } from '../catalogue';
import { boards, components, findBoardIn, getComponent } from '../library';
import type { BoardDef, Project } from '../schema';
import { formatOhms, parseOhms } from '../units';

/** Запись инвентаря: деталь библиотеки (для резисторов — с номиналом), плата или расходник из каталога (разъёмы, кабели). */
export const InventoryItem = z.object({
  kind: z.enum(['part', 'board', 'accessory']),
  id: z.string().min(1).max(80),
  value: z.string().max(20).optional(),
  /** Название для расходников из каталога (по id их не найти в библиотеке). */
  label: z.string().max(140).optional(),
  qty: z.number().int().min(1).max(999),
});
export type InventoryItem = z.infer<typeof InventoryItem>;

export const Inventory = z.object({
  items: z.array(InventoryItem).max(80),
  /** Что пользователь написал, но мы не смогли сопоставить с библиотекой — ИИ учтёт это как пожелание, а не как запас. */
  unknown: z.array(z.string().max(120)).max(30).default([]),
});
export type Inventory = z.infer<typeof Inventory>;

export const EMPTY_INVENTORY: Inventory = { items: [], unknown: [] };

/** Ключ позиции — совпадает с ключами BOM: "componentId|значение" или "board:<id>". */
export const itemKey = (i: Pick<InventoryItem, 'kind' | 'id' | 'value'>): string =>
  i.kind === 'board'
    ? `board:${i.id}`
    : i.kind === 'accessory'
      ? `acc:${i.id}`
      : bomKey(i.id, i.value);

export function addItem(inv: Inventory, item: InventoryItem): Inventory {
  const key = itemKey(item);
  const existing = inv.items.find((x) => itemKey(x) === key);
  const items = existing
    ? inv.items.map((x) => (x === existing ? { ...x, qty: Math.min(999, x.qty + item.qty) } : x))
    : [...inv.items, item];
  return { ...inv, items };
}

export const removeItem = (inv: Inventory, key: string): Inventory => ({
  ...inv,
  items: inv.items.filter((x) => itemKey(x) !== key),
});

export function setQty(inv: Inventory, key: string, qty: number): Inventory {
  if (qty < 1) return removeItem(inv, key);
  return {
    ...inv,
    items: inv.items.map((x) =>
      itemKey(x) === key ? { ...x, qty: Math.min(999, Math.floor(qty)) } : x,
    ),
  };
}

/** Сколько штук позиции есть в инвентаре. */
export const haveQty = (inv: Inventory, key: string): number =>
  inv.items.find((x) => itemKey(x) === key)?.qty ?? 0;

// ───────── разбор текста ─────────

const QTY_PREFIX = /^(\d{1,3})\s*(?:x|х|×|шт\.?|штук[аи]?|pcs\.?)?\s+(.+)$/i;
const QTY_SUFFIX = /^(.+?)\s*(?:x|х|×)\s*(\d{1,3})$/i;
const QTY_SUFFIX_WORD = /^(.+?)\s+(\d{1,3})\s*(?:шт\.?|штук[аи]?|pcs\.?)$/i;
const BARE_RESISTANCE = /^(\d+(?:[.,]\d+)?)\s*([kкmмrр])?\s*(?:ом|ohm|ohms|Ω)?$/i;
const RESISTOR_WORD = /резистор|resistor/i;

/** "10к" → "10k", "4,7 кОм" → "4.7k": приводим кириллицу и запятую к виду, который понимает parseOhms. */
function normalizeResistance(raw: string): string | undefined {
  const t = raw
    .toLowerCase()
    .replace(/ом|ohms?|Ω/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace('к', 'k')
    .replace('м', 'm')
    .replace('р', 'r');
  const ohms = parseOhms(t);
  if (!Number.isFinite(ohms) || ohms <= 0) return undefined;
  // каноническая запись: 4700 → "4.7k"
  if (ohms >= 1e6) return `${Number((ohms / 1e6).toFixed(3))}M`;
  if (ohms >= 1e3) return `${Number((ohms / 1e3).toFixed(3))}k`;
  return String(Number(ohms.toFixed(3)));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '');

function matchBoard(chunk: string): BoardDef | undefined {
  const exact = findBoardIn(boards, chunk);
  if (exact) return exact;
  const n = norm(chunk);
  return boards.find((b) =>
    [b.id, b.name, ...b.aliases].some((name) => norm(name).length >= 4 && n.includes(norm(name))),
  );
}

function matchComponent(chunk: string): string | undefined {
  const text = chunk.toLowerCase();
  let best: { id: string; score: number } | undefined;
  for (const c of components) {
    let score = 0;
    for (const tag of [c.id, ...c.tags]) {
      const t = tag.toLowerCase();
      if (t.length >= 3 && text.includes(t)) score += t.length; // более длинные совпадения весомее
    }
    if (score > 0 && (!best || score > best.score)) best = { id: c.id, score };
  }
  return best?.id;
}

/**
 * Разбор списка вида «2 светодиода, резистор 220 ом x5, 10к x3, ESP32, DHT22».
 * Количество — «2 …», «… x5», «… 5 шт»; резисторы — по слову «резистор» или по голому номиналу; платы — по названию/алиасу.
 * Нераспознанное попадает в `unknown`.
 */
export function parseInventoryText(text: string): Inventory {
  let inv: Inventory = { items: [], unknown: [] };
  // запятая между цифрами (4,7к) — десятичный разделитель, а не граница позиций
  for (const raw of text.split(/[\n;]+|(?<!\d),|,(?!\d)/)) {
    let chunk = raw.trim();
    if (!chunk) continue;
    if (/^\d{4,}\s+\D/.test(chunk)) {
      inv.unknown.push(raw.trim()); // «5000 светодиодов» — не количество, а опечатка
      continue;
    }
    let qty = 1;
    const m = QTY_PREFIX.exec(chunk) ?? null;
    const s = QTY_SUFFIX.exec(chunk) ?? QTY_SUFFIX_WORD.exec(chunk);
    if (m && !BARE_RESISTANCE.test(chunk)) {
      qty = Number(m[1]);
      chunk = m[2].trim();
    } else if (s) {
      qty = Number(s[2]);
      chunk = s[1].trim();
    }
    qty = Math.max(1, Math.min(999, qty));

    const bare = BARE_RESISTANCE.exec(chunk);
    if (bare || RESISTOR_WORD.test(chunk)) {
      const valueText = bare ? chunk : chunk.replace(RESISTOR_WORD, '').trim() || undefined;
      const value = valueText ? normalizeResistance(valueText) : undefined;
      if (bare && !value) {
        inv.unknown.push(raw.trim());
        continue;
      }
      inv = addItem(inv, { kind: 'part', id: 'resistor', ...(value && { value }), qty });
      continue;
    }
    const board = matchBoard(chunk);
    if (board) {
      inv = addItem(inv, { kind: 'board', id: board.id, qty });
      continue;
    }
    const id = matchComponent(chunk);
    if (id) inv = addItem(inv, { kind: 'part', id, qty });
    else if (!inv.unknown.includes(raw.trim())) inv.unknown.push(raw.trim());
  }
  return inv;
}

// ───────── сравнение проекта с запасами ─────────

export interface BuyItem {
  key: string;
  componentId: string;
  name: string;
  value?: string;
  qty: number;
  unitUsd?: number;
  lineUsd?: number;
  isBoard: boolean;
}
export interface InventoryFit {
  /** Всё нужное уже есть. */
  fromStock: boolean;
  buy: BuyItem[];
  /** Примерная стоимость докупки (позиции без цены не входят). */
  costUsd: number;
  /** Позиций без цены в списке докупки. */
  unpriced: number;
  /** Сколько штук каждой позиции проекта покрыто запасами: ключ → [есть из нужного, нужно]. */
  coverage: Record<string, [number, number]>;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Что из проекта есть в инвентаре, а что придётся докупить. Резисторы сопоставляются по номиналу. */
export function compareToInventory(
  project: Project,
  board: BoardDef | undefined,
  inv: Inventory,
  lines: BomLine[] = deriveBom(project, board),
): InventoryFit {
  const buy: BuyItem[] = [];
  const coverage: Record<string, [number, number]> = {};
  for (const l of lines) {
    const have = haveQty(inv, l.key);
    coverage[l.key] = [Math.min(have, l.qty), l.qty];
    const missing = l.qty - have;
    if (missing > 0)
      buy.push({
        key: l.key,
        componentId: l.componentId,
        name: l.name,
        ...(l.value && { value: l.value }),
        qty: missing,
        unitUsd: l.unitUsd,
        lineUsd: l.unitUsd === undefined ? undefined : cents(l.unitUsd * missing),
        isBoard: l.isBoard,
      });
  }
  return {
    fromStock: buy.length === 0,
    buy,
    costUsd: cents(buy.reduce((s, b) => s + (b.lineUsd ?? 0), 0)),
    unpriced: buy.filter((b) => b.lineUsd === undefined).length,
    coverage,
  };
}

/** Ключи строк BOM, которых в инвентаре хватает на весь проект — для колонки «есть у меня». */
export function ownedFromInventory(lines: BomLine[], inv: Inventory): Set<string> {
  return new Set(lines.filter((l) => haveQty(inv, l.key) >= l.qty).map((l) => l.key));
}

/** Человекочитаемое название позиции инвентаря. */
export function itemLabel(i: InventoryItem): string {
  if (i.kind === 'board') return findBoardIn(boards, i.id)?.name ?? i.id;
  if (i.kind === 'accessory') return i.label ?? findCataloguePart(i.id)?.name ?? i.id;
  const def = getComponent(i.id);
  if (def?.kind === 'resistor' && i.value) return `${def.name} ${formatOhms(parseOhms(i.value))}`;
  return def?.name ?? i.id;
}
