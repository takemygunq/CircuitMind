import type { ArtPart, BoardArt, BoardDef, PinDef, Side } from '@/core/schema';

/**
 * Детерминированный рендерер плат: BoardDef → SVG-строка (viewBox в мм).
 * Чистая функция без DOM и React: используется и в UI, и для экспорта SVG/PNG.
 * Все строки экранируются, все числа проходят через `n()`, цвета — только валидные #rrggbb.
 */

const DEFAULT_ART: BoardArt = {
  pcbColor: '#0b6e4f',
  silkColor: '#f2f2f2',
  pinStyle: 'header',
  parts: [],
};
const HEX = /^#[0-9a-fA-F]{6}$/;

const n = (v: number): number => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const color = (c: string, fallback: string): string => (HEX.test(c) ? c : fallback);

function shade(hex: string, amount: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const c = (v >> shift) & 255;
    const t = amount < 0 ? 0 : 255;
    return Math.round(c + (t - c) * Math.abs(amount));
  };
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
}

const ROT: Record<Side, number> = { bottom: 0, left: 90, top: 180, right: 270 };

export interface RenderOptions {
  /** Рисовать подписи пинов на шелкографии. По умолчанию true. */
  labels?: boolean;
  /** Рисовать декоративные дорожки. По умолчанию true. */
  traces?: boolean;
}

// ───────── пины и гребёнки ─────────

interface Strip {
  pins: PinDef[];
  horizontal: boolean;
}

/** Соседние пины (≤3 мм) объединяются в одну пластиковую гребёнку. */
function groupStrips(pins: PinDef[]): Strip[] {
  const parent = pins.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pins.length; i++)
    for (let j = i + 1; j < pins.length; j++) {
      const dx = pins[i].position.x - pins[j].position.x;
      const dy = pins[i].position.y - pins[j].position.y;
      if (Math.hypot(dx, dy) <= 3.0) parent[find(i)] = find(j);
    }
  const groups = new Map<number, PinDef[]>();
  pins.forEach((p, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), p]));
  return [...groups.values()].map((g) => {
    const xs = g.map((p) => p.position.x);
    const ys = g.map((p) => p.position.y);
    return {
      pins: g,
      horizontal: Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys),
    };
  });
}

function shortLabel(label: string): string {
  const t = label.trim();
  return t.length > 11 ? t.slice(0, 10) + '…' : t;
}

function renderStrip(s: Strip, uid: string): string {
  const xs = s.pins.map((p) => p.position.x);
  const ys = s.pins.map((p) => p.position.y);
  const pad = 1.27;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + 2 * pad;
  const h = Math.max(...ys) - Math.min(...ys) + 2 * pad;
  return `<rect x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(h)}" rx="0.25" fill="url(#${uid}-plastic)" stroke="#000" stroke-width="0.12"/>`;
}

function renderPin(p: PinDef, castellated: boolean, uid: string): string {
  const { x, y } = p.position;
  if (castellated)
    return (
      `<g class="pin" data-pin="${esc(p.id)}">` +
      `<rect x="${n(x - 1.1)}" y="${n(y - 0.8)}" width="2.2" height="1.6" rx="0.8" fill="url(#${uid}-gold)"/>` +
      `<circle cx="${n(x)}" cy="${n(y)}" r="0.5" fill="#1a1a1a"/></g>`
    );
  return (
    `<g class="pin" data-pin="${esc(p.id)}">` +
    `<circle cx="${n(x)}" cy="${n(y)}" r="0.95" fill="#2a2a2a"/>` +
    `<rect x="${n(x - 0.45)}" y="${n(y - 0.45)}" width="0.9" height="0.9" fill="url(#${uid}-gold)" stroke="#7a6417" stroke-width="0.06"/>` +
    `<rect x="${n(x - 0.18)}" y="${n(y - 0.18)}" width="0.36" height="0.36" fill="#fff6b8" opacity="0.8"/></g>`
  );
}

function renderLabel(
  p: PinDef,
  strip: Strip | undefined,
  board: BoardDef,
  silk: string,
  outline: string,
  fs: number,
): string {
  const { x, y } = p.position;
  const cx = board.size.width / 2;
  const cy = board.size.height / 2;
  const text = esc(shortLabel(p.label));
  const base = `font-family="Arial, Helvetica, sans-serif" font-size="${fs}" font-weight="600" fill="${silk}" stroke="${outline}" stroke-width="0.3" stroke-linejoin="round" paint-order="stroke"`;
  // без гребёнки (castellated) ориентацию задаёт ближайший край платы
  const nearSideEdge = Math.min(x, board.size.width - x) < Math.min(y, board.size.height - y) + 1.5;
  const horizontal = strip ? strip.horizontal : !nearSideEdge;
  if (horizontal) {
    // пины идут по X: подпись вертикальная, внутрь платы
    const down = cy > y;
    const ty = down ? y + 2.1 : y - 2.1;
    return `<text transform="translate(${n(x + 0.45)} ${n(ty)}) rotate(${down ? 90 : -90})" text-anchor="start" ${base}>${text}</text>`;
  }
  const right = cx > x;
  return `<text x="${n(right ? x + 2.1 : x - 2.1)}" y="${n(y + 0.48)}" text-anchor="${right ? 'start' : 'end'}" ${base}>${text}</text>`;
}

// ───────── декоративные элементы ─────────

function usb(p: Extract<ArtPart, { type: 'usb' }>, uid: string): string {
  const dims = {
    micro: [7.6, 5.6, 6.6, 2.2],
    mini: [8.2, 6.6, 6.9, 3.0],
    'usb-b': [12, 16, 10.5, 8],
    'usb-c': [9, 7.2, 7.8, 2.6],
  }[p.variant];
  const [w, d, mw, mh] = dims;
  // локально: разъём смотрит вниз (+y), центр в (0,0)
  return (
    `<g transform="translate(${n(p.x)} ${n(p.y)}) rotate(${ROT[p.side]})">` +
    `<rect x="${n(-w / 2)}" y="${n(-d / 2)}" width="${n(w)}" height="${n(d)}" rx="0.5" fill="url(#${uid}-metal)" stroke="#6b6f76" stroke-width="0.15"/>` +
    `<rect x="${n(-mw / 2)}" y="${n(d / 2 - 1.2 - mh * 0.6)}" width="${n(mw)}" height="${n(mh * 0.6 + 1.2)}" rx="${p.variant === 'usb-c' ? 1.2 : 0.3}" fill="#101214"/>` +
    `<rect x="${n(-mw / 2 + 0.6)}" y="${n(d / 2 - 0.9)}" width="${n(mw - 1.2)}" height="0.5" fill="#caa02c" opacity="0.8"/>` +
    `<rect x="${n(-w / 2 + 0.4)}" y="${n(-d / 2 + 0.4)}" width="${n(w - 0.8)}" height="0.6" fill="#fff" opacity="0.35"/></g>`
  );
}

function barrel(p: Extract<ArtPart, { type: 'barrel' }>): string {
  return (
    `<g transform="translate(${n(p.x)} ${n(p.y)}) rotate(${ROT[p.side]})">` +
    `<rect x="-4.5" y="-7" width="9" height="14" rx="0.6" fill="#1b1d20" stroke="#000" stroke-width="0.15"/>` +
    `<rect x="-3.4" y="1.5" width="6.8" height="5.5" rx="0.3" fill="#0a0b0c"/>` +
    `<circle cx="0" cy="5.2" r="1.2" fill="#2d3035" stroke="#555a61" stroke-width="0.15"/>` +
    `<rect x="-4" y="-6.5" width="8" height="0.7" fill="#fff" opacity="0.12"/></g>`
  );
}

function chip(p: Extract<ArtPart, { type: 'chip' }>, uid: string): string {
  const { x, y, w, h } = p;
  const x0 = x - w / 2;
  const y0 = y - h / 2;
  let legs = '';
  const leg = (lx: number, ly: number, lw: number, lh: number) =>
    `<rect x="${n(lx)}" y="${n(ly)}" width="${n(lw)}" height="${n(lh)}" fill="#c9ccd1"/>`;
  if (p.package === 'qfp' || p.package === 'qfn') {
    const pitch = p.package === 'qfp' ? 0.9 : 0.8;
    const len = p.package === 'qfp' ? 0.9 : 0.3;
    for (let i = pitch; i < w - pitch / 2; i += pitch) {
      legs += leg(x0 + i - 0.17, y0 - (p.package === 'qfp' ? len : 0), 0.34, len);
      legs += leg(x0 + i - 0.17, y0 + h - (p.package === 'qfp' ? 0 : len), 0.34, len);
    }
    for (let i = pitch; i < h - pitch / 2; i += pitch) {
      legs += leg(x0 - (p.package === 'qfp' ? len : 0), y0 + i - 0.17, len, 0.34);
      legs += leg(x0 + w - (p.package === 'qfp' ? 0 : len), y0 + i - 0.17, len, 0.34);
    }
  } else if (p.package === 'dip') {
    const count = Math.max(2, Math.floor(w / 2.54));
    for (let i = 0; i < count; i++) {
      const lx = x0 + (w - (count - 1) * 2.54) / 2 + i * 2.54;
      legs += leg(lx - 0.35, y0 - 1.0, 0.7, 1.2) + leg(lx - 0.35, y0 + h - 0.2, 0.7, 1.2);
    }
  } else if (p.package === 'soic') {
    const count = Math.max(2, Math.floor(w / 1.27));
    for (let i = 0; i < count; i++) {
      const lx = x0 + (w - (count - 1) * 1.27) / 2 + i * 1.27;
      legs += leg(lx - 0.2, y0 - 0.7, 0.4, 0.8) + leg(lx - 0.2, y0 + h - 0.1, 0.4, 0.8);
    }
  } else {
    legs +=
      leg(x0 + w * 0.2, y0 + h - 0.1, 0.4, 0.6) +
      leg(x0 + w * 0.7, y0 + h - 0.1, 0.4, 0.6) +
      leg(x0 + w * 0.45, y0 - 0.5, 0.5, 0.6);
  }
  const fs = Math.max(0.9, Math.min(1.5, (w / Math.max(6, p.label.length)) * 1.1));
  const notch =
    p.package === 'dip'
      ? `<path d="M ${n(x0)} ${n(y - 1.2)} a 1.2 1.2 0 0 1 0 2.4" fill="#000" opacity="0.6"/>`
      : `<circle cx="${n(x0 + Math.min(1.2, w * 0.18))}" cy="${n(y0 + Math.min(1.2, h * 0.18))}" r="${n(Math.min(0.5, w * 0.1))}" fill="#000" opacity="0.7"/>`;
  return (
    `<g>${legs}<rect x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(h)}" rx="0.3" fill="url(#${uid}-ic)" stroke="#000" stroke-width="0.12"/>` +
    notch +
    (p.label
      ? `<text x="${n(x)}" y="${n(y + fs * 0.35)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${n(fs)}" fill="#d7dade" opacity="0.85">${esc(p.label)}</text>`
      : '') +
    `</g>`
  );
}

function moduleShield(p: Extract<ArtPart, { type: 'module' }>, uid: string, pcb: string): string {
  const { x, y, w, h } = p;
  const x0 = x - w / 2;
  const y0 = y - h / 2;
  const ah = p.antenna ? h * 0.28 : 0;
  let antenna = '';
  if (p.antenna) {
    const zig: string[] = [];
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      const zx = x0 + 1.2 + (i * (w - 2.4)) / steps;
      zig.push(`${n(zx)},${n(y0 + (i % 2 ? 1.2 : ah - 1.4))}`);
    }
    antenna =
      `<rect x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(ah)}" fill="${shade(pcb, -0.25)}" stroke="${shade(pcb, -0.45)}" stroke-width="0.12"/>` +
      `<polyline points="${zig.join(' ')}" fill="none" stroke="#b9bcc2" stroke-width="0.45" stroke-linejoin="round" opacity="0.55"/>`;
  }
  const sy = y0 + ah;
  const sh = h - ah;
  return (
    `<g>${antenna}<rect x="${n(x0)}" y="${n(sy)}" width="${n(w)}" height="${n(sh)}" rx="0.4" fill="url(#${uid}-metal)" stroke="#6b6f76" stroke-width="0.18"/>` +
    `<rect x="${n(x0 + 0.5)}" y="${n(sy + 0.5)}" width="${n(w - 1)}" height="0.5" fill="#fff" opacity="0.4"/>` +
    (p.label
      ? `<text x="${n(x)}" y="${n(sy + sh / 2)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${n(Math.min(1.5, w / 8))}" font-weight="700" fill="#33373d" opacity="0.8">${esc(p.label)}</text>`
      : '') +
    `</g>`
  );
}

function button(p: Extract<ArtPart, { type: 'button' }>, silk: string): string {
  const c = color(p.color, '#222222');
  return (
    `<g><rect x="${n(p.x - 3)}" y="${n(p.y - 3)}" width="6" height="6" rx="0.5" fill="#b9bcc2" stroke="#6b6f76" stroke-width="0.15"/>` +
    [
      [-2.2, -2.2],
      [2.2, -2.2],
      [-2.2, 2.2],
      [2.2, 2.2],
    ]
      .map(
        ([dx, dy]) => `<circle cx="${n(p.x + dx)}" cy="${n(p.y + dy)}" r="0.35" fill="#555a61"/>`,
      )
      .join('') +
    `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="1.9" fill="${c}" stroke="${shade(c, -0.5)}" stroke-width="0.2"/>` +
    `<circle cx="${n(p.x - 0.5)}" cy="${n(p.y - 0.5)}" r="0.7" fill="#fff" opacity="0.28"/>` +
    (p.label
      ? `<text x="${n(p.x)}" y="${n(p.y + 5)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="1.3" font-weight="600" fill="${silk}">${esc(p.label)}</text>`
      : '') +
    `</g>`
  );
}

function led(p: Extract<ArtPart, { type: 'led' }>, silk: string): string {
  const c = color(p.color, '#ff3030');
  return (
    `<g><rect x="${n(p.x - 1.1)}" y="${n(p.y - 0.6)}" width="2.2" height="1.2" rx="0.15" fill="#d8d3c4" stroke="#8a8572" stroke-width="0.08"/>` +
    `<rect x="${n(p.x - 0.55)}" y="${n(p.y - 0.5)}" width="1.1" height="1" fill="${c}"/>` +
    (p.label
      ? `<text x="${n(p.x)}" y="${n(p.y + 2.2)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="1.1" font-weight="600" fill="${silk}">${esc(p.label)}</text>`
      : '') +
    `</g>`
  );
}

function crystal(p: Extract<ArtPart, { type: 'crystal' }>, uid: string): string {
  return (
    `<g><rect x="${n(p.x - p.w / 2)}" y="${n(p.y - p.h / 2)}" width="${n(p.w)}" height="${n(p.h)}" rx="${n(Math.min(p.w, p.h) * 0.3)}" fill="url(#${uid}-metal)" stroke="#6b6f76" stroke-width="0.15"/>` +
    `<rect x="${n(p.x - p.w / 2 + 0.3)}" y="${n(p.y - p.h / 2 + 0.3)}" width="${n(p.w - 0.6)}" height="${n(p.h - 0.6)}" rx="0.3" fill="none" stroke="#9aa0a8" stroke-width="0.1"/></g>`
  );
}

function smd(p: Extract<ArtPart, { type: 'smd' }>, silk: string): string {
  const body = { resistor: '#17181a', capacitor: '#b48a4e', inductor: '#5a5d63' }[p.kind];
  const capW = Math.min(0.5, p.w * 0.25);
  return (
    `<g><rect x="${n(p.x - p.w / 2)}" y="${n(p.y - p.h / 2)}" width="${n(p.w)}" height="${n(p.h)}" rx="0.1" fill="${body}"/>` +
    `<rect x="${n(p.x - p.w / 2)}" y="${n(p.y - p.h / 2)}" width="${n(capW)}" height="${n(p.h)}" fill="#cfcfcf"/>` +
    `<rect x="${n(p.x + p.w / 2 - capW)}" y="${n(p.y - p.h / 2)}" width="${n(capW)}" height="${n(p.h)}" fill="#cfcfcf"/>` +
    (p.label
      ? `<text x="${n(p.x)}" y="${n(p.y + p.h / 2 + 1.3)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="1" fill="${silk}">${esc(p.label)}</text>`
      : '') +
    `</g>`
  );
}

function extraHeader(p: Extract<ArtPart, { type: 'header' }>, uid: string): string {
  const cols = Math.min(Math.max(p.cols, 1), 40);
  const rows = Math.min(Math.max(p.rows, 1), 40);
  let out = `<rect x="${n(p.x - 1.27)}" y="${n(p.y - 1.27)}" width="${n((cols - 1) * p.pitch + 2.54)}" height="${n((rows - 1) * p.pitch + 2.54)}" rx="0.25" fill="url(#${uid}-plastic)" stroke="#000" stroke-width="0.12"/>`;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cx = p.x + c * p.pitch;
      const cy = p.y + r * p.pitch;
      out += `<rect x="${n(cx - 0.45)}" y="${n(cy - 0.45)}" width="0.9" height="0.9" fill="url(#${uid}-gold)" stroke="#7a6417" stroke-width="0.06"/>`;
    }
  return `<g>${out}</g>`;
}

function renderPart(p: ArtPart, uid: string, art: BoardArt, silk: string): string {
  switch (p.type) {
    case 'usb':
      return usb(p, uid);
    case 'barrel':
      return barrel(p);
    case 'chip':
      return chip(p, uid);
    case 'module':
      return moduleShield(p, uid, art.pcbColor);
    case 'button':
      return button(p, silk);
    case 'led':
      return led(p, silk);
    case 'crystal':
      return crystal(p, uid);
    case 'smd':
      return smd(p, silk);
    case 'header':
      return extraHeader(p, uid);
    case 'text':
      return `<text transform="translate(${n(p.x)} ${n(p.y)}) rotate(${n(p.rotate)})" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${n(p.size)}" font-weight="700" fill="${silk}">${esc(p.text)}</text>`;
    case 'hole':
      return `<g><circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.d / 2 + 0.7)}" fill="url(#${uid}-gold)"/><circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.d / 2)}" fill="#0c0c0c"/></g>`;
  }
}

// ───────── дорожки ─────────

function renderTraces(board: BoardDef, art: BoardArt, targets: { x: number; y: number }[]): string {
  if (!targets.length) return '';
  const stroke = shade(art.pcbColor, 0.2);
  const cx = board.size.width / 2;
  const cy = board.size.height / 2;
  const paths = board.pins
    .map((p) => {
      let best = targets[0];
      let bd = Infinity;
      for (const t of targets) {
        const d = Math.hypot(t.x - p.position.x, t.y - p.position.y);
        if (d < bd) [best, bd] = [t, d];
      }
      const { x, y } = p.position;
      // выходим от пина внутрь платы, затем ортогонально к цели
      const nearSide = Math.min(x, board.size.width - x) < Math.min(y, board.size.height - y);
      const sx = nearSide ? (x < cx ? x + 3.4 : x - 3.4) : x;
      const sy = nearSide ? y : y < cy ? y + 3.4 : y - 3.4;
      return `M ${n(x)} ${n(y)} L ${n(sx)} ${n(sy)} L ${n(nearSide ? best.x : sx)} ${n(nearSide ? sy : best.y)} L ${n(best.x)} ${n(best.y)}`;
    })
    .join(' ');
  return `<path d="${paths}" fill="none" stroke="${stroke}" stroke-width="0.28" stroke-linejoin="round" stroke-linecap="round" opacity="0.55"/>`;
}

// ───────── сборка ─────────

/** Содержимое платы (defs + группы) без внешнего <svg>: для встраивания в общий холст диаграммы. */
export function renderBoardInner(board: BoardDef, options: RenderOptions = {}): string {
  const { labels = true, traces = true } = options;
  const art = board.art ?? DEFAULT_ART;
  const pcb = color(art.pcbColor, DEFAULT_ART.pcbColor);
  const silk = color(art.silkColor, DEFAULT_ART.silkColor);
  const uid = 'b' + board.id.replace(/[^a-z0-9]/gi, '');
  const { width: W, height: H } = board.size;
  const castellated = art.pinStyle === 'castellated';

  const defs =
    `<defs>` +
    `<linearGradient id="${uid}-pcb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(pcb, 0.12)}"/><stop offset="0.5" stop-color="${pcb}"/><stop offset="1" stop-color="${shade(pcb, -0.18)}"/></linearGradient>` +
    `<linearGradient id="${uid}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7e48a"/><stop offset="1" stop-color="#b8901f"/></linearGradient>` +
    `<linearGradient id="${uid}-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f5f7"/><stop offset="0.5" stop-color="#c3c7ce"/><stop offset="1" stop-color="#9ea3ab"/></linearGradient>` +
    `<linearGradient id="${uid}-ic" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3d42"/><stop offset="1" stop-color="#121315"/></linearGradient>` +
    `<linearGradient id="${uid}-plastic" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34363a"/><stop offset="1" stop-color="#17181a"/></linearGradient>` +
    `</defs>`;

  const body =
    `<rect x="0" y="0" width="${n(W)}" height="${n(H)}" rx="1.6" fill="url(#${uid}-pcb)" stroke="${shade(pcb, -0.55)}" stroke-width="0.25"/>` +
    `<rect x="0.45" y="0.45" width="${n(W - 0.9)}" height="${n(H - 0.9)}" rx="1.2" fill="none" stroke="${shade(pcb, 0.3)}" stroke-width="0.12" opacity="0.6"/>`;

  const targets = art.parts
    .filter(
      (p): p is Extract<ArtPart, { type: 'chip' | 'module' }> =>
        p.type === 'chip' || p.type === 'module',
    )
    .map((p) => ({ x: p.x, y: p.y }));

  const strips = castellated ? [] : groupStrips(board.pins);
  const stripOf = new Map<string, Strip>();
  strips.forEach((s) => s.pins.forEach((p) => stripOf.set(p.id, s)));

  const holes = art.parts.filter((p) => p.type === 'hole');
  const text = art.parts.filter((p) => p.type === 'text');
  const rest = art.parts.filter((p) => p.type !== 'hole' && p.type !== 'text');

  return (
    defs +
    `<g class="board-body">${body}</g>` +
    (traces ? `<g class="traces">${renderTraces(board, art, targets)}</g>` : '') +
    `<g class="holes">${holes.map((p) => renderPart(p, uid, art, silk)).join('')}</g>` +
    `<g class="parts">${rest.map((p) => renderPart(p, uid, art, silk)).join('')}</g>` +
    `<g class="strips">${strips.map((s) => renderStrip(s, uid)).join('')}</g>` +
    `<g class="pins">${board.pins.map((p) => renderPin(p, castellated, uid)).join('')}</g>` +
    (labels
      ? `<g class="labels">${board.pins.map((p) => renderLabel(p, stripOf.get(p.id), board, silk, shade(pcb, -0.6), castellated ? 1.1 : 1.3)).join('')}</g>`
      : '') +
    `<g class="silk">${text.map((p) => renderPart(p, uid, art, silk)).join('')}</g>`
  );
}

export function renderBoardSvg(board: BoardDef, options: RenderOptions = {}): string {
  const { width: W, height: H } = board.size;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-1} ${-1} ${n(W + 2)} ${n(H + 2)}" width="${n(W * 10)}" height="${n(H * 10)}" role="img" aria-label="${esc(board.name)}" data-board="${esc(board.id)}">` +
    renderBoardInner(board, options) +
    `</svg>`
  );
}
