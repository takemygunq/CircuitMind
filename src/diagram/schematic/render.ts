import type { BoardDef, Project } from '@/core/schema';
import { ELEM_LEN, buildSchematic, type Schematic } from './model';
import { SYMBOLS, elementBody, labelRise } from './symbols';

export interface Palette {
  ink: string;
  muted: string;
  fill: string;
  bg: string;
}
/** Для интерфейса: цвета из CSS-переменных темы. */
export const CSS_PALETTE: Palette = {
  ink: 'var(--ink)',
  muted: 'var(--muted)',
  fill: 'var(--panel)',
  bg: 'var(--canvas)',
};
export const EXPORT_PALETTES: Record<'light' | 'dark', Palette> = {
  light: { ink: '#1b2430', muted: '#5b6573', fill: '#ffffff', bg: '#ffffff' },
  dark: { ink: '#e6ebf2', muted: '#94a0b2', fill: '#151b24', bg: '#10161e' },
};

const n = (v: number) => Math.round(v * 100) / 100;
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT = 'font-family="ui-monospace, SFMono-Regular, Menlo, monospace"';

const line = (x1: number, y1: number, x2: number, y2: number, p: Palette, w = 0.55) =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${p.ink}" stroke-width="${w}" stroke-linecap="round"/>`;

function text(
  x: number,
  y: number,
  s: string,
  size: number,
  fill: string,
  anchor: 'start' | 'middle' | 'end' = 'start',
  weight = 400,
): string {
  return `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${FONT}>${esc(s)}</text>`;
}

/** Фото деталей из каталога: ключ связи → адрес картинки. */
export type PartImages = Record<string, string>;

const photo = (x: number, y: number, size: number, href: string) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${size}" height="${size}" rx="${n(size * 0.2)}" fill="#fff" stroke="${'#d9d3c5'}" stroke-width="0.3"/>` +
  `<image href="${esc(href)}" x="${n(x + size * 0.08)}" y="${n(y + size * 0.08)}" width="${n(size * 0.84)}" height="${n(size * 0.84)}" preserveAspectRatio="xMidYMid meet"/>`;

export function renderSchematicInner(s: Schematic, p: Palette, images: PartImages = {}): string {
  const out: string[] = [];

  // провода и выводы
  for (const w of s.wires)
    out.push(`<g data-net="${w.net}">${line(w.a.x, w.a.y, w.b.x, w.b.y, p)}</g>`);
  // точки соединения на дорожках: вывод в середине дорожки
  const byNet = new Map<number, typeof s.wires>();
  for (const w of s.wires) byNet.set(w.net, [...(byNet.get(w.net) ?? []), w]);
  for (const [net, ws] of byNet) {
    const track = ws.find((w) => w.a.x === w.b.x && w.a.y !== w.b.y);
    if (!track) continue;
    const lo = Math.min(track.a.y, track.b.y);
    const hi = Math.max(track.a.y, track.b.y);
    for (const w of ws)
      if (w !== track && w.a.y > lo + 0.01 && w.a.y < hi - 0.01)
        out.push(
          `<circle data-net="${net}" cx="${n(track.a.x)}" cy="${n(w.a.y)}" r="1.1" fill="${p.ink}"/>`,
        );
  }
  for (const w of s.stubs) out.push(line(w.a.x, w.a.y, w.b.x, w.b.y, p));

  // блоки
  for (const b of s.blocks) {
    out.push(
      `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="1.5" fill="${p.fill}" stroke="${p.ink}" stroke-width="0.9"/>`,
    );
    const img = b.linkKey ? images[b.linkKey] : undefined;
    if (img) out.push(photo(b.x + b.w - 15, b.y + 3, 12, img));
    if (b.board) out.push(text(b.x + b.w / 2, b.y + 8, b.title, 4.2, p.ink, 'middle', 700));
    else {
      out.push(text(b.x + 3, b.y + 7, b.title, 4.4, p.ink, 'start', 700));
      if (b.subtitle) out.push(text(b.x + 3, b.y + 12, b.subtitle, 3, p.muted));
    }
    for (const pin of b.pins) {
      const left = b.side === 'left';
      out.push(
        `<g opacity="${pin.connected ? 1 : 0.5}">${text(left ? b.x + 3 : b.x + b.w - 3, b.y + pin.y + 1.2, pin.label, 3.4, p.ink, left ? 'start' : 'end')}</g>`,
      );
    }
  }

  // двухвыводные детали
  for (const e of s.elements) {
    out.push(elementBody(e.kind, e.x, e.y, e.rev, p));
    const eImg = e.linkKey ? images[e.linkKey] : undefined;
    if (eImg) out.push(photo(e.x + ELEM_LEN / 2 - 3.5, e.y - labelRise(e.kind) - 12, 7, eImg));
    out.push(text(e.x + ELEM_LEN / 2, e.y - labelRise(e.kind), e.label, 3.8, p.ink, 'middle', 700));
    if (e.value)
      out.push(
        text(
          e.x + ELEM_LEN / 2,
          e.y + (e.kind === 'motor' ? 17 : 11),
          e.value,
          3.4,
          p.muted,
          'middle',
        ),
      );
  }

  // транзисторы, потенциометр, реле
  for (const sy of s.symbols) {
    const spec = SYMBOLS[sy.kind];
    out.push(spec.draw(sy.x, sy.y, p));
    const sImg = sy.linkKey ? images[sy.linkKey] : undefined;
    if (sImg) out.push(photo(sy.x + spec.w / 2 - 3.5, sy.y - 11, 7, sImg));
    out.push(text(sy.x + spec.w / 2, sy.y - 3, sy.label, 3.8, p.ink, 'middle', 700));
    if (sy.value)
      out.push(text(sy.x + spec.w / 2, sy.y + spec.h + 6, sy.value, 3.4, p.muted, 'middle'));
  }

  // знаки питания и метки цепей
  for (const m of s.marks) {
    const x1 = m.x + m.dir * 4;
    const anchor = m.dir > 0 ? 'start' : 'end';
    out.push(`<g data-net="${m.net}">`);
    if (m.kind === 'gnd') {
      out.push(line(m.x, m.y, x1, m.y, p));
      out.push(line(x1, m.y - 4.5, x1, m.y + 4.5, p));
      out.push(line(x1 + m.dir * 2, m.y - 3, x1 + m.dir * 2, m.y + 3, p));
      out.push(line(x1 + m.dir * 4, m.y - 1.5, x1 + m.dir * 4, m.y + 1.5, p));
    } else if (m.kind === 'power') {
      out.push(line(m.x, m.y, x1, m.y, p));
      out.push(line(x1, m.y - 3.5, x1, m.y + 3.5, p));
      out.push(text(x1 + m.dir * 2.5, m.y + 1.2, m.text, 3.4, p.ink, anchor, 600));
    } else {
      out.push(line(m.x, m.y, m.x + m.dir * 3, m.y, p, 0.6));
      out.push(`<circle cx="${n(m.x + m.dir * 3)}" cy="${n(m.y)}" r="0.9" fill="${p.ink}"/>`);
      out.push(text(m.x + m.dir * 5, m.y + 1.2, m.text, 3.4, p.ink, anchor, 600));
    }
    out.push('</g>');
  }
  for (const t of s.netNames) out.push(text(t.x, t.y, t.text, 2.8, p.muted));
  return out.join('');
}

export interface SchematicSvg {
  svg: string;
  width: number;
  height: number;
}

/** Автономный SVG принципиальной схемы (без CSS-переменных) — для экспорта. */
export function renderSchematicSvg(
  project: Project,
  board: BoardDef,
  options: {
    theme?: 'light' | 'dark';
    background?: boolean;
    pxPerUnit?: number;
    images?: PartImages;
  } = {},
): SchematicSvg {
  const pal = EXPORT_PALETTES[options.theme ?? 'light'];
  const s = buildSchematic(project, board);
  const vb = { x: -6, y: -4, w: s.width + 6, h: s.height + 8 };
  const k = options.pxPerUnit ?? 6;
  const width = Math.round(vb.w * k);
  const height = Math.round(vb.h * k);
  const title = `${project.title} — ${board.name}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${n(vb.w)} ${n(vb.h)}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">` +
    `<title>${esc(title)}</title>` +
    (options.background
      ? `<rect x="${vb.x}" y="${vb.y}" width="${n(vb.w)}" height="${n(vb.h)}" fill="${pal.bg}"/>`
      : '') +
    renderSchematicInner(s, pal, options.images) +
    `</svg>`;
  return { svg, width, height };
}
