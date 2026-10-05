import { computeNets } from '@/core/nets';
import type { BoardDef, Point, Project } from '@/core/schema';
import { renderBoardInner } from './board-art/render';
import { COMPONENT_DEFS } from './component-art/render';
import { GROUP_COLORS, primaryGroup } from './colors';
import { boardPinExit, layoutParts, partRect, sceneBounds } from './layout';
import { boardPinUsage, computeWires } from './project-view';
import { roundedPath } from './routing';

export type ExportTheme = 'light' | 'dark';
const PALETTE: Record<ExportTheme, { ink: string; background: string; muted: string }> = {
  light: { ink: '#1b2430', background: '#ffffff', muted: '#5b6573' },
  dark: { ink: '#e6ebf2', background: '#10161e', muted: '#94a0b2' },
};

export interface ExportOptions {
  theme?: ExportTheme;
  /** Рисовать фон (для PNG/печати) или оставить прозрачным. */
  background?: boolean;
  /** Пикселей на мм для атрибутов width/height. */
  pxPerMm?: number;
  /** Позиции, изменённые перетаскиванием. */
  overrides?: Record<string, Point>;
}
export interface ExportedSvg {
  svg: string;
  width: number;
  height: number;
}

const n = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const MAX_PX = 8192;

function wrap(
  vb: { x: number; y: number; w: number; h: number },
  body: string,
  title: string,
  o: ExportOptions,
): ExportedSvg {
  const t = PALETTE[o.theme ?? 'light'];
  const scale = Math.min(o.pxPerMm ?? 12, MAX_PX / Math.max(vb.w, vb.h));
  const width = Math.round(vb.w * scale);
  const height = Math.round(vb.h * scale);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}" color="${t.ink}">` +
    `<title>${esc(title)}</title><defs>${COMPONENT_DEFS}</defs>` +
    (o.background
      ? `<rect x="${n(vb.x)}" y="${n(vb.y)}" width="${n(vb.w)}" height="${n(vb.h)}" fill="${t.background}"/>`
      : '') +
    body +
    `</svg>`;
  return { svg, width, height };
}

/** Автономный SVG схемы подключения: плата, детали, провода, подписи. Без внешних ссылок и CSS-переменных. */
export function renderWiringSvg(
  project: Project,
  board: BoardDef,
  options: ExportOptions = {},
): ExportedSvg {
  const t = PALETTE[options.theme ?? 'light'];
  const placed = layoutParts(project, board, options.overrides ?? {});
  const wires = computeWires(project, board, placed, computeNets(project));
  const b = sceneBounds(board, placed);
  const vb = { x: b.x - 6, y: b.y - 12, w: b.w + 12, h: b.h + 18 };

  const parts = placed
    .map((p) => {
      if (!p.art) return '';
      const r = partRect(p)!;
      return (
        `<g class="part" data-part="${esc(p.part.instanceId)}" transform="translate(${n(p.position.x)} ${n(p.position.y)})">${p.art.svg}</g>` +
        `<text x="${n(r.x + r.w / 2)}" y="${n(r.y - 1.2)}" text-anchor="middle" font-size="1.7" font-weight="700" fill="${t.ink}" font-family="ui-monospace, monospace">${esc(p.part.instanceId)}</text>`
      );
    })
    .join('');

  const wireSvg = wires
    .map((w) => {
      const d = roundedPath(w.points);
      return (
        `<g class="wire" data-from="${esc(w.from.endpoint)}" data-to="${esc(w.to.endpoint)}">` +
        `<path d="${d}" fill="none" stroke="${t.background}" stroke-opacity="0.85" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="${d}" fill="none" stroke="${w.color}" stroke-width="0.38" stroke-linecap="round" stroke-linejoin="round"/>` +
        [w.from, w.to]
          .map((e) =>
            e.position
              ? `<circle cx="${n(e.position.x)}" cy="${n(e.position.y)}" r="0.6" fill="${w.color}" stroke="${t.background}" stroke-width="0.3"/>`
              : '',
          )
          .join('') +
        `</g>`
      );
    })
    .join('');

  const title = `<text x="${n(vb.x + 1)}" y="${n(vb.y + 4)}" font-size="3" font-weight="700" fill="${t.ink}" font-family="Arial, Helvetica, sans-serif">${esc(project.title)}</text>`;
  return wrap(
    vb,
    `<g class="board">${renderBoardInner(board)}</g>${parts}${wireSvg}${title}`,
    project.title,
    options,
  );
}

/** Автономный SVG распиновки: плата, задействованные пины с кольцами цвета функции и подписями «куда подключено». */
export function renderPinoutSvg(
  project: Project,
  board: BoardDef,
  options: ExportOptions = {},
): ExportedSvg {
  const t = PALETTE[options.theme ?? 'light'];
  const usage = boardPinUsage(computeNets(project));
  const vb = { x: -34, y: -6, w: board.size.width + 68, h: board.size.height + 12 };

  const pins = board.pins
    .map((pin) => {
      const used = usage.get(pin.id);
      if (!used) return '';
      const color = GROUP_COLORS[primaryGroup(pin)];
      const { x, y } = pin.position;
      const d = boardPinExit(board, pin.position);
      const x0 = x + d.dx * 2.8;
      const y0 = y + d.dy * 2.8;
      const horizontal = d.dx !== 0;
      const label = esc(used.length > 1 ? `${used[0]} +${used.length - 1}` : (used[0] ?? ''));
      return (
        `<circle class="pin-ring" cx="${n(x)}" cy="${n(y)}" r="1.3" fill="${color}" fill-opacity="0.4" stroke="${color}" stroke-width="0.45"/>` +
        `<line x1="${n(x + d.dx * 1.6)}" y1="${n(y + d.dy * 1.6)}" x2="${n(x0)}" y2="${n(y0)}" stroke="${t.ink}" stroke-width="0.2" opacity="0.5"/>` +
        `<text transform="translate(${n(x0 + d.dx * 0.6)} ${n(y0 + d.dy * 0.6 + (horizontal ? 0.5 : 0))}) rotate(${horizontal ? 0 : d.dy < 0 ? -90 : 90})" text-anchor="${horizontal ? (d.dx > 0 ? 'start' : 'end') : 'start'}" font-size="1.6" font-weight="600" fill="${t.ink}" font-family="ui-monospace, monospace">${label}</text>`
      );
    })
    .join('');
  return wrap(
    vb,
    `<g class="board">${renderBoardInner(board)}</g>${pins}`,
    `${board.name} — ${project.title}`,
    options,
  );
}
