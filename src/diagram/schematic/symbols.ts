import type { Palette } from './render';

export const ELEM_LEN = 40; // длина двухвыводного символа вместе с выводами

const n = (v: number) => Math.round(v * 100) / 100;

export const line = (x1: number, y1: number, x2: number, y2: number, p: Palette, w = 0.55) =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${p.ink}" stroke-width="${w}" stroke-linecap="round"/>`;
const path = (d: string, p: Palette, fill = 'none', w = 0.8) =>
  `<path d="${d}" fill="${fill}" stroke="${p.ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const circle = (cx: number, cy: number, r: number, p: Palette, fill: string) =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${r}" fill="${fill}" stroke="${p.ink}" stroke-width="0.55"/>`;
const dot = (cx: number, cy: number, p: Palette) =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="1.2" fill="${p.ink}"/>`;
const label = (x: number, y: number, s: string, size: number, p: Palette, weight = 700) =>
  `<text x="${n(x)}" y="${n(y)}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${p.ink}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${s}</text>`;

/** Виды двухвыводных деталей, для которых есть обозначение. */
export const DISCRETE_KINDS = new Set([
  'resistor',
  'thermistor',
  'ntc',
  'ldr',
  'varistor',
  'capacitor',
  'capacitor_polarized',
  'electrolytic',
  'inductor',
  'diode',
  'led',
  'zener',
  'schottky',
  'button',
  'switch',
  'motor',
  'buzzer',
  'speaker',
  'battery',
  'fuse',
  'lamp',
]);

/** Двухвыводная деталь: выводы на левом и правом краях, ось по y. Развёрнутая (rev) зеркалится вокруг центра. */
export function elementBody(kind: string, x: number, y: number, rev: boolean, p: Palette): string {
  const L = ELEM_LEN;
  const lead = (a: number, b: number) => line(x + a, y, x + b, y, p);
  const box = (a = 10, b = 30, h = 4) =>
    `<rect x="${x + a}" y="${y - h}" width="${b - a}" height="${2 * h}" fill="${p.fill}" stroke="${p.ink}" stroke-width="0.55"/>`;
  const tri = (barOffset = 0) =>
    path(`M ${x + 14} ${y - 5} L ${x + 14} ${y + 5} L ${x + 26} ${y} Z`, p) +
    line(x + 26, y - 5 + barOffset, x + 26, y + 5, p);
  let body: string;
  switch (kind) {
    case 'led':
      body =
        lead(0, 14) +
        tri() +
        path(
          `M ${x + 18} ${y - 7} l 5 -5 m -3 0 l 3 0 l 0 3 M ${x + 23} ${y - 4.5} l 5 -5 m -3 0 l 3 0 l 0 3`,
          p,
          'none',
          0.6,
        ) +
        lead(26, L);
      break;
    case 'diode':
      body = lead(0, 14) + tri() + lead(26, L);
      break;
    case 'zener':
      body =
        lead(0, 14) +
        path(`M ${x + 14} ${y - 5} L ${x + 14} ${y + 5} L ${x + 26} ${y} Z`, p) +
        path(
          `M ${x + 23} ${y - 7} L ${x + 26} ${y - 5} L ${x + 26} ${y + 5} L ${x + 29} ${y + 7}`,
          p,
        ) +
        lead(26, L);
      break;
    case 'schottky':
      body =
        lead(0, 14) +
        path(`M ${x + 14} ${y - 5} L ${x + 14} ${y + 5} L ${x + 26} ${y} Z`, p) +
        path(
          `M ${x + 23} ${y - 5} L ${x + 23} ${y - 7} L ${x + 26} ${y - 7} L ${x + 26} ${y + 7} L ${x + 29} ${y + 7} L ${x + 29} ${y + 5}`,
          p,
        ) +
        lead(26, L);
      break;
    case 'button':
    case 'switch':
      body =
        lead(0, 14) +
        dot(x + 14, y, p) +
        dot(x + 26, y, p) +
        line(x + 14, y, x + 25, y - 7, p) +
        (kind === 'button' ? line(x + 17, y - 9.5, x + 23, y - 9.5, p, 0.6) : '') +
        lead(26, L);
      break;
    case 'motor':
      body =
        lead(0, 10) +
        circle(x + 20, y, 10, p, p.fill) +
        label(x + 20, y + 2.2, 'M', 6, p) +
        lead(30, L);
      break;
    case 'buzzer':
    case 'speaker':
      body =
        lead(0, 12) +
        path(
          `M ${x + 12} ${y - 5} L ${x + 12} ${y + 5} M ${x + 12} ${y - 5} L ${x + 22} ${y - 9} L ${x + 22} ${y + 9} L ${x + 12} ${y + 5}`,
          p,
          p.fill,
        ) +
        path(`M ${x + 25} ${y - 4} Q ${x + 28} ${y} ${x + 25} ${y + 4}`, p) +
        lead(28, L);
      break;
    case 'battery':
      body =
        lead(0, 16) +
        line(x + 16, y - 8, x + 16, y + 8, p, 1.1) +
        line(x + 22, y - 4.5, x + 22, y + 4.5, p, 1.1) +
        line(x + 28, y - 8, x + 28, y + 8, p, 1.1) +
        line(x + 34, y - 4.5, x + 34, y + 4.5, p, 1.1) +
        lead(34, L);
      break;
    case 'capacitor':
      body =
        lead(0, 17) +
        line(x + 17, y - 7, x + 17, y + 7, p, 1.1) +
        line(x + 23, y - 7, x + 23, y + 7, p, 1.1) +
        lead(23, L);
      break;
    case 'capacitor_polarized':
    case 'electrolytic':
      body =
        lead(0, 17) +
        line(x + 17, y - 7, x + 17, y + 7, p, 1.1) +
        path(`M ${x + 25} ${y - 7} Q ${x + 21} ${y} ${x + 25} ${y + 7}`, p) +
        line(x + 11, y - 6, x + 11, y - 2, p, 0.6) +
        line(x + 9, y - 4, x + 13, y - 4, p, 0.6) +
        lead(24, L);
      break;
    case 'inductor':
      body =
        lead(0, 8) +
        path(`M ${x + 8} ${y} a 3.5 3.5 0 0 1 8 0 a 3.5 3.5 0 0 1 8 0 a 3.5 3.5 0 0 1 8 0`, p) +
        lead(32, L);
      break;
    case 'fuse':
      body = lead(0, 10) + box() + line(x + 10, y, x + 30, y, p, 0.6) + lead(30, L);
      break;
    case 'lamp':
      body =
        lead(0, 10) +
        circle(x + 20, y, 10, p, p.fill) +
        line(x + 13, y - 7, x + 27, y + 7, p) +
        line(x + 13, y + 7, x + 27, y - 7, p) +
        lead(30, L);
      break;
    case 'thermistor':
    case 'ntc':
    case 'ldr':
    case 'varistor':
      body = lead(0, 10) + box() + line(x + 7, y + 8, x + 33, y - 8, p, 0.7) + lead(30, L);
      break;
    default:
      // резистор и неизвестные двухвыводные детали
      body = lead(0, 10) + box() + lead(30, L);
  }
  // полярность: развёрнутая деталь зеркалится, подписи остаются читаемыми
  return rev ? `<g transform="translate(${n(2 * x + L)} 0) scale(-1 1)">${body}</g>` : body;
}

/** Высота подписи над двухвыводной деталью (светодиоду нужно место под стрелки). */
export const labelRise = (kind: string): number =>
  kind === 'led'
    ? 15
    : kind === 'button' || kind === 'switch'
      ? 13
      : kind === 'motor' || kind === 'lamp'
        ? 14
        : 9;

// ───────── трёхвыводные и составные символы ─────────

export interface SymbolSpec {
  w: number;
  h: number;
  /** pinId → положение вывода относительно левого верхнего угла и направление (куда смотрит вывод). */
  terminals: Record<string, [number, number, 1 | -1]>;
  draw(x: number, y: number, p: Palette): string;
}

const transistor = (polarity: 'npn' | 'pnp'): SymbolSpec => ({
  w: 24,
  h: 28,
  terminals: { B: [0, 14, -1], C: [24, 3, 1], E: [24, 25, 1] },
  draw: (x, y, p) =>
    circle(x + 14, y + 14, 12.5, p, 'none').replace('stroke-width="0.55"', 'stroke-width="0.5"') +
    line(x, y + 14, x + 10, y + 14, p) +
    line(x + 10, y + 7, x + 10, y + 21, p, 1.4) +
    path(
      `M ${x + 10} ${y + 11} L ${x + 19} ${y + 5} L ${x + 19} ${y + 3} L ${x + 24} ${y + 3}`,
      p,
    ) +
    path(
      `M ${x + 10} ${y + 17} L ${x + 19} ${y + 23} L ${x + 19} ${y + 25} L ${x + 24} ${y + 25}`,
      p,
    ) +
    // стрелка на эмиттере: NPN — от базы, PNP — к базе
    (polarity === 'npn'
      ? path(
          `M ${x + 19} ${y + 23} L ${x + 15.5} ${y + 22.5} M ${x + 19} ${y + 23} L ${x + 17.5} ${y + 20}`,
          p,
        )
      : path(
          `M ${x + 11.5} ${y + 17.8} L ${x + 15} ${y + 18.3} M ${x + 11.5} ${y + 17.8} L ${x + 13} ${y + 20.8}`,
          p,
        )),
});

const mosfet = (channel: 'n' | 'p'): SymbolSpec => ({
  w: 26,
  h: 28,
  terminals: { G: [0, 14, -1], D: [26, 3, 1], S: [26, 25, 1] },
  draw: (x, y, p) =>
    line(x, y + 14, x + 8, y + 14, p) +
    line(x + 8, y + 7, x + 8, y + 21, p, 1.2) +
    line(x + 12, y + 5, x + 12, y + 10, p, 1.2) +
    line(x + 12, y + 11.5, x + 12, y + 16.5, p, 1.2) +
    line(x + 12, y + 18, x + 12, y + 23, p, 1.2) +
    path(
      `M ${x + 12} ${y + 7.5} L ${x + 20} ${y + 7.5} L ${x + 20} ${y + 3} L ${x + 26} ${y + 3}`,
      p,
    ) +
    path(
      `M ${x + 12} ${y + 20.5} L ${x + 20} ${y + 20.5} L ${x + 20} ${y + 25} L ${x + 26} ${y + 25}`,
      p,
    ) +
    path(`M ${x + 12} ${y + 14} L ${x + 20} ${y + 14} L ${x + 20} ${y + 20.5}`, p) +
    // стрелка канала: N — к каналу, P — от канала
    (channel === 'n'
      ? path(
          `M ${x + 12} ${y + 14} L ${x + 15} ${y + 12.4} M ${x + 12} ${y + 14} L ${x + 15} ${y + 15.6}`,
          p,
        )
      : path(
          `M ${x + 20} ${y + 14} L ${x + 17} ${y + 12.4} M ${x + 20} ${y + 14} L ${x + 17} ${y + 15.6}`,
          p,
        )),
});

const POTENTIOMETER: SymbolSpec = {
  w: 30,
  h: 40,
  terminals: { '1': [30, 2, 1], wiper: [0, 20, -1], '3': [30, 38, 1] },
  draw: (x, y, p) =>
    `<rect x="${x + 12}" y="${y + 10}" width="8" height="20" fill="${p.fill}" stroke="${p.ink}" stroke-width="0.55"/>` +
    path(`M ${x + 16} ${y + 10} L ${x + 16} ${y + 2} L ${x + 30} ${y + 2}`, p) +
    path(`M ${x + 16} ${y + 30} L ${x + 16} ${y + 38} L ${x + 30} ${y + 38}`, p) +
    line(x, y + 20, x + 11, y + 20, p) +
    path(
      `M ${x + 11} ${y + 20} L ${x + 7.5} ${y + 18} M ${x + 11} ${y + 20} L ${x + 7.5} ${y + 22}`,
      p,
    ),
};

const RELAY: SymbolSpec = {
  w: 60,
  h: 26,
  terminals: {
    'COIL+': [0, 7, -1],
    'COIL-': [0, 19, -1],
    COM: [60, 13, 1],
    NO: [60, 6, 1],
    NC: [60, 20, 1],
  },
  draw: (x, y, p) =>
    `<rect x="${x + 10}" y="${y + 4}" width="12" height="18" fill="${p.fill}" stroke="${p.ink}" stroke-width="0.55"/>` +
    line(x, y + 7, x + 10, y + 7, p) +
    line(x, y + 19, x + 10, y + 19, p) +
    `<line x1="${x + 22}" y1="${y + 13}" x2="${x + 36}" y2="${y + 13}" stroke="${p.ink}" stroke-width="0.6" stroke-dasharray="1.6 1.2"/>` +
    dot(x + 38, y + 13, p) +
    line(x + 38, y + 13, x + 60, y + 13, p) +
    line(x + 38, y + 13, x + 50, y + 7.5, p) +
    dot(x + 51, y + 6, p) +
    line(x + 51, y + 6, x + 60, y + 6, p) +
    dot(x + 51, y + 20, p) +
    line(x + 51, y + 20, x + 60, y + 20, p) +
    label(x + 16, y + 15, 'K', 4.2, p),
};

export const SYMBOLS: Record<string, SymbolSpec> = {
  npn: transistor('npn'),
  pnp: transistor('pnp'),
  nmos: mosfet('n'),
  pmos: mosfet('p'),
  potentiometer: POTENTIOMETER,
  relay: RELAY,
};
