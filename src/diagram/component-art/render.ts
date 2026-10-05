import type { ComponentDef } from '@/core/schema';
import { formatOhms, parseOhms, resistorBands } from '@/core/units';

/**
 * Детерминированный рендер компонентов. Система координат — локальная: пины лежат в `pin.position`,
 * тело рисуется относительно них. Возвращает SVG-фрагмент, габариты и направление выхода провода у каждого пина.
 * Градиенты берутся из COMPONENT_DEFS (вставляется в <svg> один раз).
 */

export interface Dir {
  dx: number;
  dy: number;
}
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ComponentArt {
  svg: string;
  bbox: BBox;
  exits: Record<string, Dir>;
}

const UP: Dir = { dx: 0, dy: -1 };
const DOWN: Dir = { dx: 0, dy: 1 };
const LEFT: Dir = { dx: -1, dy: 0 };
const RIGHT: Dir = { dx: 1, dy: 0 };

const n = (v: number): number => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const FONT = 'font-family="Arial, Helvetica, sans-serif"';

export const COMPONENT_DEFS =
  `<linearGradient id="cm-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7e48a"/><stop offset="1" stop-color="#b8901f"/></linearGradient>` +
  `<linearGradient id="cm-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f5f7"/><stop offset="0.5" stop-color="#c3c7ce"/><stop offset="1" stop-color="#8f949c"/></linearGradient>` +
  `<linearGradient id="cm-black" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3d42"/><stop offset="1" stop-color="#121315"/></linearGradient>` +
  `<radialGradient id="cm-dome" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/></radialGradient>`;

const text = (
  s: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  anchor = 'middle',
  weight = 600,
): string =>
  `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" ${FONT} font-size="${n(size)}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`;

const leg = (x1: number, y1: number, x2: number, y2: number): string =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#d3d6db" stroke-width="0.55" stroke-linecap="round"/>`;

export const LED_COLORS: Record<string, string> = {
  red: '#ff3b3b',
  green: '#35d44a',
  blue: '#3b82f6',
  yellow: '#f5d90a',
  white: '#f2f2f2',
  orange: '#ff8a1f',
};

function pinLabels(def: ComponentDef, dy: number, size: number, fill: string): string {
  return def.pins.map((p) => text(p.label, p.position.x, p.position.y + dy, size, fill)).join('');
}

function led(def: ComponentDef): ComponentArt {
  const c = LED_COLORS[String(def.params.color ?? 'red')] ?? LED_COLORS.red;
  const svg =
    leg(0, 0, 0, -3) +
    leg(2.54, 0, 2.54, -3) +
    `<path d="M -1.28 -3.1 L -1.28 -5.2 A 2.55 2.55 0 0 1 3.82 -5.2 L 3.82 -3.1 Z" fill="${c}" fill-opacity="0.88" stroke="#00000055" stroke-width="0.15"/>` +
    `<path d="M -1.28 -3.1 L -1.28 -5.2 A 2.55 2.55 0 0 1 3.82 -5.2 L 3.82 -3.1 Z" fill="url(#cm-dome)"/>` +
    `<rect x="-1.7" y="-3.35" width="5.94" height="0.6" rx="0.2" fill="${c}" fill-opacity="0.95" stroke="#00000055" stroke-width="0.12"/>` +
    `<path d="M 3.2 -3.1 L 3.82 -3.1 L 3.82 -3.5 Z" fill="#00000030"/>`;
  return {
    svg,
    bbox: { x: -1.8, y: -8, w: 6.2, h: 8.6 },
    exits: { anode: DOWN, cathode: DOWN },
  };
}

function resistor(value?: string): ComponentArt {
  const ohms = value ? parseOhms(value) : NaN;
  const bands = resistorBands(ohms);
  const xs = [3.3, 4.5, 5.7, 7.1];
  const svg =
    leg(0, 0, 2.4, 0) +
    leg(7.6, 0, 10, 0) +
    `<rect x="2.2" y="-1.35" width="5.6" height="2.7" rx="1.2" fill="#d9c7a0" stroke="#8c7b55" stroke-width="0.15"/>` +
    bands
      .map((c, i) => `<rect x="${xs[i]}" y="-1.35" width="0.65" height="2.7" fill="${c}"/>`)
      .join('') +
    `<rect x="2.6" y="-1.1" width="4.8" height="0.5" rx="0.25" fill="#fff" opacity="0.35"/>` +
    (value
      ? text(
          Number.isFinite(ohms) ? formatOhms(ohms) : value,
          5,
          3.6,
          1.3,
          'currentColor',
          'middle',
          700,
        )
      : '');
  return { svg, bbox: { x: -0.5, y: -1.6, w: 11, h: 5.6 }, exits: { '1': LEFT, '2': RIGHT } };
}

function button(): ComponentArt {
  const svg =
    leg(0, 0, 0, 1) +
    leg(6, 0, 6, 1) +
    `<rect x="-0.4" y="0.6" width="6.8" height="6" rx="0.6" fill="#b9bcc2" stroke="#6b6f76" stroke-width="0.15"/>` +
    [
      [0.5, 1.5],
      [5.5, 1.5],
      [0.5, 5.7],
      [5.5, 5.7],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.35" fill="#555a61"/>`)
      .join('') +
    `<circle cx="3" cy="3.6" r="2" fill="#26282c" stroke="#0e0f10" stroke-width="0.2"/>` +
    `<circle cx="2.4" cy="3" r="0.7" fill="#fff" opacity="0.25"/>`;
  return { svg, bbox: { x: -0.8, y: -0.5, w: 7.6, h: 7.4 }, exits: { '1': UP, '2': UP } };
}

function potentiometer(def: ComponentDef): ComponentArt {
  const svg =
    leg(0, 0, 0, 1.5) +
    leg(2.5, 0, 2.5, 1.5) +
    leg(5, 0, 5, 1.5) +
    `<rect x="-2.2" y="1.2" width="9.4" height="2.2" rx="0.4" fill="#2b5fb4" stroke="#17366b" stroke-width="0.15"/>` +
    `<circle cx="2.5" cy="7.6" r="4.7" fill="#2b5fb4" stroke="#17366b" stroke-width="0.2"/>` +
    `<circle cx="2.5" cy="7.6" r="3.2" fill="url(#cm-metal)" stroke="#6b6f76" stroke-width="0.15"/>` +
    `<rect x="1.9" y="4.7" width="1.2" height="5.8" rx="0.4" fill="#41464d" transform="rotate(35 2.5 7.6)"/>` +
    pinLabels(def, 1.15, 0.9, '#ffffff');
  return {
    svg,
    bbox: { x: -2.6, y: -0.5, w: 10.2, h: 13.3 },
    exits: { '1': UP, wiper: UP, '3': UP },
  };
}

function transistorLabels(def: ComponentDef): string {
  return def.pins
    .map((p) => text(p.label, p.position.x, p.position.y - 1.1, 1.2, 'currentColor', 'middle', 700))
    .join('');
}

function npn(def: ComponentDef): ComponentArt {
  const svg =
    leg(0, 0, 0, -2.2) +
    leg(2.54, 0, 2.54, -2.2) +
    leg(5.08, 0, 5.08, -2.2) +
    `<path d="M -0.1 -2.4 L -0.1 -4.9 A 2.65 2.65 0 0 1 5.18 -4.9 L 5.18 -2.4 Z" fill="url(#cm-black)" stroke="#000" stroke-width="0.15"/>` +
    `<rect x="0.5" y="-5" width="4.1" height="1.2" fill="#fff" opacity="0.08"/>` +
    text('2N2222', 2.54, -3.3, 1, '#d7dade', 'middle', 600) +
    transistorLabels(def).replace(/y="-1.1"/g, 'y="0.9"');
  return { svg, bbox: { x: -0.6, y: -7.8, w: 6.3, h: 9.2 }, exits: { E: DOWN, B: DOWN, C: DOWN } };
}

function mosfet(def: ComponentDef): ComponentArt {
  const svg =
    leg(0, 0, 0, -3) +
    leg(2.54, 0, 2.54, -3) +
    leg(5.08, 0, 5.08, -3) +
    `<rect x="-2.4" y="-9.5" width="9.9" height="6.6" rx="0.4" fill="url(#cm-black)" stroke="#000" stroke-width="0.15"/>` +
    `<rect x="-2.4" y="-15.2" width="9.9" height="5.7" rx="0.4" fill="url(#cm-metal)" stroke="#6b6f76" stroke-width="0.15"/>` +
    `<circle cx="2.54" cy="-12.6" r="1.7" fill="#fff" stroke="#6b6f76" stroke-width="0.15"/>` +
    text('IRLZ44N', 2.54, -6, 1.2, '#d7dade', 'middle', 600) +
    transistorLabels(def).replace(/y="-1.1"/g, 'y="1"');
  return {
    svg,
    bbox: { x: -2.8, y: -15.6, w: 10.7, h: 17.4 },
    exits: { G: DOWN, D: DOWN, S: DOWN },
  };
}

function diode(): ComponentArt {
  const svg =
    leg(0, 0, 1.6, 0) +
    leg(6.4, 0, 8, 0) +
    `<rect x="1.6" y="-1.35" width="4.8" height="2.7" rx="0.5" fill="#1b1c1f" stroke="#000" stroke-width="0.15"/>` +
    `<rect x="5.1" y="-1.35" width="0.9" height="2.7" fill="#d9dbe0"/>` +
    text('1N4007', 3.4, 0.35, 0.9, '#cfd2d8', 'middle', 600);
  return { svg, bbox: { x: -0.5, y: -1.6, w: 9, h: 3.2 }, exits: { anode: LEFT, cathode: RIGHT } };
}

function dht22(def: ComponentDef): ComponentArt {
  const grille = Array.from(
    { length: 6 },
    (_, i) =>
      `<rect x="-1.6" y="${n(11 + i * 1.6)}" width="10.8" height="0.7" rx="0.35" fill="#b7bec6"/>`,
  ).join('');
  const svg =
    pinLabels(def, 2.6, 0.95, '#2a2f36') +
    `<rect x="-3.74" y="0.8" width="15.1" height="20" rx="1" fill="#eceff3" stroke="#a9b1ba" stroke-width="0.2"/>` +
    `<rect x="-3.1" y="1.4" width="13.8" height="1" fill="#fff" opacity="0.7"/>` +
    grille +
    text('DHT22', 3.81, 8.8, 1.8, '#2a2f36', 'middle', 700) +
    def.pins.map((p) => leg(p.position.x, p.position.y, p.position.x, p.position.y + 0.9)).join('');
  return {
    svg,
    bbox: { x: -4, y: -0.8, w: 15.6, h: 22 },
    exits: { VCC: UP, DATA: UP, NC: UP, GND: UP },
  };
}

function ssd1306(def: ComponentDef): ComponentArt {
  const lines = [0, 1, 2, 3]
    .map(
      (i) =>
        `<rect x="${-5.5 + (i % 2) * 1.5}" y="${8.2 + i * 2.6}" width="${12 - i * 1.4}" height="0.9" fill="#4de3ff" opacity="0.85"/>`,
    )
    .join('');
  const svg =
    `<rect x="-9.7" y="0.8" width="27" height="27" rx="1" fill="#1a56c4" stroke="#0e3079" stroke-width="0.25"/>` +
    pinLabels(def, 2.7, 0.95, '#ffffff') +
    `<rect x="-8.2" y="5.6" width="24" height="16.4" rx="0.5" fill="#0a0b0d" stroke="#2a2d33" stroke-width="0.2"/>` +
    `<rect x="-6.8" y="7" width="21.2" height="13.6" fill="#05070a"/>` +
    lines +
    def.pins
      .map((p) => leg(p.position.x, p.position.y, p.position.x, p.position.y + 0.9))
      .join('') +
    text('OLED 0.96"', 3.81, 26.1, 1.1, '#cfe1ff', 'middle', 600);
  return {
    svg,
    bbox: { x: -10, y: -0.8, w: 27.6, h: 29.4 },
    exits: { GND: UP, VCC: UP, SCL: UP, SDA: UP },
  };
}

function servo(def: ComponentDef): ComponentArt {
  const svg =
    `<rect x="-9" y="3.4" width="23" height="12" rx="0.8" fill="#2a6fd6" stroke="#1a4a96" stroke-width="0.25"/>` +
    `<rect x="-11.4" y="8.4" width="2.6" height="2" fill="#2a6fd6" stroke="#1a4a96" stroke-width="0.2"/>` +
    `<rect x="14.2" y="8.4" width="2.6" height="2" fill="#2a6fd6" stroke="#1a4a96" stroke-width="0.2"/>` +
    `<circle cx="10.2" cy="9.4" r="3.1" fill="#e9eaee" stroke="#8b8f97" stroke-width="0.2"/>` +
    `<rect x="9.4" y="3.6" width="1.6" height="6.8" rx="0.7" fill="#e9eaee" stroke="#8b8f97" stroke-width="0.2"/>` +
    `<rect x="-1.5" y="-1.2" width="9.1" height="4.8" rx="0.5" fill="url(#cm-black)" stroke="#000" stroke-width="0.15"/>` +
    pinLabels(def, 1.9, 0.95, '#e8e8e8') +
    text('SG90', -3.2, 10.5, 1.6, '#e8f0ff', 'middle', 700);
  return {
    svg,
    bbox: { x: -11.6, y: -1.5, w: 28.6, h: 17.2 },
    exits: { GND: UP, VCC: UP, SIG: UP },
  };
}

function hcsr04(def: ComponentDef): ComponentArt {
  const cyl = (cx: number) =>
    `<circle cx="${cx}" cy="12" r="8.3" fill="url(#cm-metal)" stroke="#6b6f76" stroke-width="0.25"/>` +
    `<circle cx="${cx}" cy="12" r="6.1" fill="#1d2025"/>` +
    `<circle cx="${cx}" cy="12" r="3.2" fill="#2d3138" stroke="#555a61" stroke-width="0.2"/>`;
  const svg =
    `<rect x="-18.7" y="0.8" width="45" height="21" rx="0.8" fill="#1558b0" stroke="#0c3a75" stroke-width="0.25"/>` +
    cyl(-9.2) +
    cyl(16.8) +
    pinLabels(def, 2.7, 0.95, '#ffffff') +
    def.pins
      .map((p) => leg(p.position.x, p.position.y, p.position.x, p.position.y + 0.9))
      .join('') +
    text('HC-SR04', 3.81, 14.6, 1.6, '#ffffff', 'middle', 700);
  return {
    svg,
    bbox: { x: -19, y: -0.8, w: 45.6, h: 23.8 },
    exits: { VCC: UP, TRIG: UP, ECHO: UP, GND: UP },
  };
}

function generic(def: ComponentDef): ComponentArt {
  const xs = def.pins.map((p) => p.position.x);
  const ys = def.pins.map((p) => p.position.y);
  const x0 = Math.min(...xs) - 2;
  const x1 = Math.max(...xs) + 2;
  const y0 = Math.min(...ys);
  const h = Math.max(8, def.size.height);
  const svg =
    `<rect x="${n(x0)}" y="${n(y0 + 0.6)}" width="${n(x1 - x0)}" height="${n(h)}" rx="0.8" fill="#e8eaee" stroke="#9aa1ab" stroke-width="0.25" stroke-dasharray="${def.verified ? 'none' : '1 0.6'}"/>` +
    def.pins.map((p) => leg(p.position.x, p.position.y, p.position.x, p.position.y + 1)).join('') +
    pinLabels(def, 2.7, 0.95, '#2a2f36') +
    text(def.name, (x0 + x1) / 2, y0 + 0.6 + h / 2, 1.3, '#2a2f36', 'middle', 700);
  const exits = Object.fromEntries(def.pins.map((p) => [p.id, UP]));
  return { svg, bbox: { x: x0 - 0.3, y: y0 - 1, w: x1 - x0 + 0.6, h: h + 2 }, exits };
}

export function renderComponentArt(def: ComponentDef, value?: string): ComponentArt {
  switch (def.kind) {
    case 'led':
      return led(def);
    case 'resistor':
      return resistor(value);
    case 'button':
      return button();
    case 'potentiometer':
      return potentiometer(def);
    case 'npn':
      return npn(def);
    case 'nmos':
      return mosfet(def);
    case 'diode':
      return diode();
    case 'dht22':
      return dht22(def);
    case 'ssd1306':
      return ssd1306(def);
    case 'servo':
      return servo(def);
    case 'hcsr04':
      return hcsr04(def);
    default:
      return generic(def);
  }
}
