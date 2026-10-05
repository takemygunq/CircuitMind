import { getComponent } from './library';
import { parseOhms } from './units';
import type { BoardDef, ComponentDef, Project } from './schema';

export interface BomLine {
  /** Стабильный ключ строки: "componentId|значение" (для платы — "board:<id>"). Используется для отметки «есть у меня». */
  key: string;
  componentId: string;
  name: string;
  value?: string;
  package?: string;
  category: string;
  qty: number;
  refs: string[];
  unitUsd?: number;
  lineUsd?: number;
  unverified: boolean;
  isBoard: boolean;
}

const norm = (v: string | undefined) => (v ?? '').trim();
export const bomKey = (componentId: string, value?: string): string =>
  `${componentId}|${norm(value)}`;
/** Номиналы сравниваем как числа (220 Ω < 4.7 kΩ), прочие значения — как текст. */
function compareValues(a = '', b = ''): number {
  const x = parseOhms(a);
  const y = parseOhms(b);
  return Number.isFinite(x) && Number.isFinite(y)
    ? x - y
    : a.localeCompare(b, undefined, { numeric: true });
}
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Спецификация по реальным деталям проекта (источник правды — `parts`, а не список ИИ):
 * плата первой, затем детали, сгруппированные по компоненту и номиналу.
 */
export function deriveBom(
  project: Project,
  board?: BoardDef,
  lookup: (id: string) => ComponentDef | undefined = getComponent,
): BomLine[] {
  const lines = new Map<string, BomLine>();
  for (const part of project.parts) {
    const key = bomKey(part.componentId, part.value);
    const existing = lines.get(key);
    if (existing) {
      existing.qty++;
      existing.refs.push(part.instanceId);
      if (existing.unitUsd !== undefined) existing.lineUsd = cents(existing.unitUsd * existing.qty);
      continue;
    }
    const def = lookup(part.componentId);
    lines.set(key, {
      key,
      componentId: part.componentId,
      name: def?.name ?? part.componentId,
      value: norm(part.value) || undefined,
      package: def?.package,
      category: def?.category ?? 'generic',
      qty: 1,
      refs: [part.instanceId],
      unitUsd: def?.priceUsd,
      lineUsd: def?.priceUsd,
      unverified: !def || !def.verified,
      isBoard: false,
    });
  }
  const sorted = [...lines.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || compareValues(a.value, b.value),
  );
  const boardLine: BomLine = {
    key: `board:${project.boardId}`,
    componentId: project.boardId,
    name: board?.name ?? project.boardId,
    category: 'board',
    qty: 1,
    refs: ['board'],
    unitUsd: board?.priceUsd,
    lineUsd: board?.priceUsd,
    unverified: board ? !board.verified : true,
    isBoard: true,
    package: 'Dev board',
  };
  return [boardLine, ...sorted];
}

/** Ключи строк, отмеченные ИИ как «уже есть у пользователя». */
export function initialOwned(project: Project): Set<string> {
  return new Set(project.bom.filter((b) => b.owned).map((b) => bomKey(b.componentId, b.value)));
}

export interface BomMismatch {
  key: string;
  expected: number;
  declared: number;
}

/** Расхождения между спецификацией ИИ (`project.bom`) и фактическими деталями: пропущенные, лишние, неверное количество. */
export function compareBom(project: Project, lines: BomLine[]): BomMismatch[] {
  const declared = new Map<string, number>();
  for (const b of project.bom)
    declared.set(
      bomKey(b.componentId, b.value),
      (declared.get(bomKey(b.componentId, b.value)) ?? 0) + b.qty,
    );
  const out: BomMismatch[] = [];
  const keys = new Set([...declared.keys(), ...lines.filter((l) => !l.isBoard).map((l) => l.key)]);
  for (const key of keys) {
    const expected = lines.find((l) => l.key === key)?.qty ?? 0;
    const got = declared.get(key) ?? 0;
    if (expected !== got) out.push({ key, expected, declared: got });
  }
  return out;
}

export interface BomTotals {
  totalUsd: number;
  toBuyUsd: number;
  ownedUsd: number;
  /** Сколько строк без известной цены — итог занижен. */
  unpriced: number;
}
export function bomTotals(lines: BomLine[], owned: ReadonlySet<string>): BomTotals {
  let total = 0;
  let toBuy = 0;
  let unpriced = 0;
  for (const l of lines) {
    if (l.lineUsd === undefined) {
      unpriced++;
      continue;
    }
    total += l.lineUsd;
    if (!owned.has(l.key)) toBuy += l.lineUsd;
  }
  return {
    totalUsd: cents(total),
    toBuyUsd: cents(toBuy),
    ownedUsd: cents(total - toBuy),
    unpriced,
  };
}

// ───────── CSV ─────────

/** Ячейка CSV (RFC 4180). Текст, начинающийся с = + - @ (формулы Excel/Sheets), нейтрализуется апострофом. */
export function csvCell(value: string | number | boolean | undefined): string {
  if (value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface BomCsvLabels {
  refs: string;
  component: string;
  value: string;
  package: string;
  qty: string;
  unit: string;
  line: string;
  owned: string;
}
export const CSV_LABELS_EN: BomCsvLabels = {
  refs: 'Refs',
  component: 'Component',
  value: 'Value',
  package: 'Package',
  qty: 'Qty',
  unit: 'Unit price (USD)',
  line: 'Line total (USD)',
  owned: 'Owned',
};

/** CSV со спецификацией. UTF-8 с BOM и CRLF — открывается в Excel без «кракозябр». */
export function bomToCsv(
  lines: BomLine[],
  owned: ReadonlySet<string>,
  labels: BomCsvLabels = CSV_LABELS_EN,
  yes = 'yes',
  no = 'no',
): string {
  const rows = [
    [
      labels.refs,
      labels.component,
      labels.value,
      labels.package,
      labels.qty,
      labels.unit,
      labels.line,
      labels.owned,
    ]
      .map(csvCell)
      .join(','),
    ...lines.map((l) =>
      [
        csvCell(l.refs.join(' ')),
        csvCell(l.name),
        csvCell(l.value),
        csvCell(l.package),
        csvCell(l.qty),
        csvCell(l.unitUsd?.toFixed(2)),
        csvCell(l.lineUsd?.toFixed(2)),
        csvCell(owned.has(l.key) ? yes : no),
      ].join(','),
    ),
  ];
  return '﻿' + rows.join('\r\n') + '\r\n';
}
