import fs from 'node:fs';
import path from 'node:path';
import { connectorsCatalogue } from '@/core/catalogue';

export interface CatalogueItem {
  id: string;
  name: string;
  brand?: string;
  sku?: string;
  /** Раздел верхнего уровня: "Connectors & cables". */
  category: string;
  /** Подраздел: "Connectors". */
  sub: string;
  description?: string;
  /** Локальный файл (если картинка скачана) либо исходная ссылка. */
  image: string;
  source?: string;
  /** Логическая распиновка (по данным страницы детали). */
  pins?: { type?: string; label: string; voltage?: string; function?: string }[];
  /** Предложения магазинов. */
  offers?: {
    vendor?: string;
    price?: number;
    currency?: string;
    availability?: string;
    url?: string;
  }[];
  /** Слаги аналогов из того же семейства. */
  alternates?: string[];
}

/** Поток Next.js кладёт вместо пустых значений строку "$undefined". */
const clean = (v?: string) => (v && v !== '$undefined' ? v : undefined);

const FILE = path.join(process.cwd(), 'library', 'catalogue', 'schematik.jsonl');
const IMG_DIR = path.join(process.cwd(), 'public', 'parts', 'catalogue');

let cache: { mtime: number; items: CatalogueItem[] } | undefined;

function loadSchematik(): CatalogueItem[] {
  const text = fs.readFileSync(FILE, 'utf8');
  const local = new Set(fs.existsSync(IMG_DIR) ? fs.readdirSync(IMG_DIR) : []);
  const items: CatalogueItem[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const p = JSON.parse(line) as {
        slug: string;
        name: string;
        brand?: string;
        sku?: string;
        category?: string;
        description?: string;
        image?: string;
        source?: string;
        pins?: CatalogueItem['pins'];
        offers?: CatalogueItem['offers'];
        alternates?: string[];
      };
      const [category, sub] = (p.category ?? 'Other').split(' / ');
      const jpg = `${p.slug}.jpg`;
      items.push({
        id: p.slug,
        name: p.name,
        brand: p.brand,
        sku: p.sku,
        category: category || 'Other',
        sub: sub || category || 'Other',
        description: p.description,
        image: local.has(jpg) ? `/parts/catalogue/${jpg}` : (p.image ?? ''),
        source: p.source,
        pins: p.pins?.map((x) => ({
          ...x,
          voltage: clean(x.voltage),
          function: clean(x.function),
        })),
        offers: p.offers,
        alternates: p.alternates,
      });
    } catch {
      /* битая строка (обрыв записи при остановке импорта) — пропускаем */
    }
  }
  return items;
}

/** Каталог деталей: импорт Schematik (scripts/import-schematik.mjs), а без него — наш небольшой список разъёмов и кабелей. */
export function catalogueItems(): CatalogueItem[] {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (!cache || cache.mtime !== mtime) cache = { mtime, items: loadSchematik() };
    if (cache.items.length) return cache.items;
  } catch {
    /* файла импорта нет */
  }
  return connectorsCatalogue.map((p) => ({
    id: p.id,
    name: p.name,
    category: 'Connectors & cables',
    sub: p.family,
    image: `/parts/${p.image}.jpg`,
  }));
}

export interface CatalogueQuery {
  q?: string;
  category?: string;
  sub?: string;
  offset?: number;
  limit?: number;
}

export function queryCatalogue(query: CatalogueQuery) {
  const all = catalogueItems();
  const words = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const matches = all.filter(
    (p) =>
      (!query.category || p.category === query.category) &&
      (!query.sub || p.sub === query.sub) &&
      words.every((w) =>
        `${p.name} ${p.brand ?? ''} ${p.sku ?? ''} ${p.sub} ${p.category}`
          .toLowerCase()
          .includes(w),
      ),
  );
  const counts = (key: 'category' | 'sub', from: CatalogueItem[]) => {
    const m = new Map<string, number>();
    for (const p of from) m.set(p[key], (m.get(p[key]) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  };
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(96, Math.max(1, query.limit ?? 48));
  return {
    total: matches.length,
    all: all.length,
    items: matches.slice(offset, offset + limit),
    categories: counts('category', all),
    subs: query.category
      ? counts(
          'sub',
          all.filter((p) => p.category === query.category),
        )
      : [],
  };
}

const STOP = new Set(['the', 'with', 'and', 'for', 'pin', 'pcs', 'pack', 'module', 'board', 'kit']);
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9.]+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );

/** Деталь и её аналоги: те же подраздел и бренд/слова в названии (ранжирование по числу общих слов). */
export function catalogueDetail(id: string) {
  const all = catalogueItems();
  const part = all.find((p) => p.id === id);
  if (!part) return null;
  const mine = words(part.name);
  const byId = new Map(all.map((p) => [p.id, p]));
  // аналоги с сайта, если они были в данных; иначе подбираем по подразделу и названию
  const listed = (part.alternates ?? [])
    .map((a) => byId.get(a))
    .filter((p): p is CatalogueItem => !!p);
  const alternates = listed.length
    ? listed
    : all
        .filter((p) => p.id !== id && p.sub === part.sub)
        .map((p) => {
          let score = p.brand && p.brand === part.brand ? 1 : 0;
          for (const w of words(p.name)) if (mine.has(w)) score += 1;
          return { p, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map((x) => x.p);
  return { part, alternates };
}

const LINKS_FILE = path.join(process.cwd(), 'library', 'catalogue', 'links.json');

export interface CatalogueLink {
  id: string;
  name: string;
  image: string;
  /** Логическая распиновка из каталога (если есть). */
  pins?: { type?: string; label: string; function?: string; voltage?: string }[];
}

/** Связи «деталь/плата библиотеки → карточка каталога»: картинка и страница с распиновкой берутся из каталога. */
export function catalogueLinks(): Record<string, CatalogueLink> {
  let raw: Record<string, string> = {};
  try {
    raw = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
  } catch {
    return {};
  }
  const byId = new Map(catalogueItems().map((p) => [p.id, p]));
  const out: Record<string, CatalogueLink> = {};
  for (const [key, slug] of Object.entries(raw)) {
    const p = byId.get(slug);
    if (key !== '_comment' && p)
      out[key] = { id: p.id, name: p.name, image: p.image, pins: p.pins };
  }
  return out;
}
