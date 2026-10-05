import type { Connection, PinDef, PinFunction } from '@/core/schema';

/** Группы функций пинов для цветовой легенды. */
export type FunctionGroup =
  'power' | 'gnd' | 'gpio' | 'adc' | 'pwm' | 'i2c' | 'spi' | 'uart' | 'touch' | 'other';

export const GROUP_ORDER: FunctionGroup[] = [
  'power',
  'gnd',
  'gpio',
  'adc',
  'pwm',
  'i2c',
  'spi',
  'uart',
  'touch',
  'other',
];

export const GROUP_COLORS: Record<FunctionGroup, string> = {
  power: '#e63946',
  gnd: '#4b5563',
  gpio: '#94a3b8',
  adc: '#f5c518',
  pwm: '#ff8a1f',
  i2c: '#3b82f6',
  spi: '#9b5de5',
  uart: '#ff6fa5',
  touch: '#2fb344',
  other: '#6b7280',
};

export function functionGroup(fn: PinFunction): FunctionGroup {
  switch (fn) {
    case 'power':
    case 'gnd':
    case 'gpio':
    case 'pwm':
    case 'touch':
    case 'other':
      return fn;
    case 'adc':
    case 'dac':
      return 'adc';
    case 'i2c_sda':
    case 'i2c_scl':
      return 'i2c';
    case 'spi_mosi':
    case 'spi_miso':
    case 'spi_sck':
    case 'spi_cs':
      return 'spi';
    case 'uart_tx':
    case 'uart_rx':
      return 'uart';
  }
}

const PRIORITY: FunctionGroup[] = [
  'power',
  'gnd',
  'i2c',
  'spi',
  'uart',
  'adc',
  'pwm',
  'touch',
  'gpio',
  'other',
];

/** Основная группа пина (определяет цвет): специализированные функции важнее обычного GPIO. */
export function primaryGroup(pin: Pick<PinDef, 'functions'>): FunctionGroup {
  const groups = new Set(pin.functions.map(functionGroup));
  return PRIORITY.find((g) => groups.has(g)) ?? 'other';
}

export const pinColor = (pin: Pick<PinDef, 'functions'>): string => GROUP_COLORS[primaryGroup(pin)];

export const WIRE_COLORS: Record<string, string> = {
  red: '#e63946',
  black: '#2b2d31',
  green: '#2fb344',
  blue: '#3b82f6',
  yellow: '#f5c518',
  orange: '#ff8a1f',
  purple: '#9b5de5',
  white: '#f1f1f1',
  brown: '#8b5a2b',
  gray: '#8a8f98',
  cyan: '#22c3d6',
  pink: '#ff6fa5',
};

const SIGNAL_COLOR: Partial<Record<PinFunction, string>> = {
  power: WIRE_COLORS.red,
  gnd: WIRE_COLORS.black,
  i2c_sda: WIRE_COLORS.blue,
  i2c_scl: WIRE_COLORS.yellow,
  spi_mosi: WIRE_COLORS.purple,
  spi_miso: WIRE_COLORS.pink,
  spi_sck: WIRE_COLORS.orange,
  spi_cs: WIRE_COLORS.brown,
  uart_tx: WIRE_COLORS.cyan,
  uart_rx: WIRE_COLORS.green,
};

/** Цвет провода: явный цвет из проекта → по сигналу → по функции пинов → зелёный. */
export function wireColor(
  conn: Pick<Connection, 'color' | 'signal'>,
  pins: (Pick<PinDef, 'functions'> | undefined)[] = [],
): string {
  if (conn.color) {
    if (WIRE_COLORS[conn.color.toLowerCase()]) return WIRE_COLORS[conn.color.toLowerCase()];
    if (/^#[0-9a-fA-F]{6}$/.test(conn.color)) return conn.color;
  }
  if (conn.signal && SIGNAL_COLOR[conn.signal]) return SIGNAL_COLOR[conn.signal]!;
  for (const p of pins) {
    if (!p) continue;
    for (const fn of ['power', 'gnd'] as const)
      if (p.functions.includes(fn)) return SIGNAL_COLOR[fn]!;
  }
  return WIRE_COLORS.green;
}

/** Тёмные провода (земля, чёрный) на тёмном фоне не видны: в тёмной теме осветляем цвет, сохраняя оттенок. */
export function adaptWire(color: string, dark: boolean): string {
  if (!dark) return color;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) return color;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luma > 70) return color;
  // растягиваем яркость до читаемой на фоне #0c0c0e
  const k = 150 / Math.max(luma, 30);
  const f = (v: number) =>
    Math.min(255, Math.round(v * k + 30))
      .toString(16)
      .padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}
