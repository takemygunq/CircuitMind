/** Разбор номиналов вида "220", "4.7k", "4k7", "1M", "100R" в омы. NaN, если не распознано. */
export function parseOhms(input: string): number {
  const s = input
    .trim()
    .replace(/\s+/g, '')
    .replace(/Ω|ohms?$/i, '');
  const m = /^(\d+)([kKmMrR])(\d+)?$/.exec(s) ?? /^(\d+(?:[.,]\d+)?)([kKmMrR])?$/.exec(s);
  if (!m) return NaN;
  const mult = { k: 1e3, m: 1e6, r: 1 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'r'] ?? 1;
  // "4k7" → 4.7k, "4.7k" → 4.7k
  const base = m[3] !== undefined ? Number(`${m[1]}.${m[3]}`) : Number(m[1].replace(',', '.'));
  return Math.round(base * mult * 1e6) / 1e6;
}

export function formatOhms(ohms: number): string {
  if (!Number.isFinite(ohms)) return '?';
  const trim = (n: number) => String(Math.round(n * 100) / 100);
  if (ohms >= 1e6) return `${trim(ohms / 1e6)} MΩ`;
  if (ohms >= 1e3) return `${trim(ohms / 1e3)} kΩ`;
  return `${trim(ohms)} Ω`;
}

const BAND_COLORS = [
  '#111111',
  '#7b4a21',
  '#d62828',
  '#f77f00',
  '#f2d400',
  '#2a9d3c',
  '#2b6cd6',
  '#8e44ad',
  '#8a8a8a',
  '#f4f4f4',
];

/** Цветовая маркировка 4 кольца (2 цифры + множитель + допуск ±5% золото). */
export function resistorBands(ohms: number): string[] {
  if (!Number.isFinite(ohms) || ohms < 1) return ['#8a8a8a', '#8a8a8a', '#8a8a8a', '#c9a227'];
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / 10 ** exp);
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    exp += 1;
  }
  if (exp < 0) return ['#8a8a8a', '#8a8a8a', '#8a8a8a', '#c9a227']; // < 10 Ω: золотой/серебряный множитель не рисуем
  return [
    BAND_COLORS[Math.floor(digits / 10)],
    BAND_COLORS[digits % 10],
    BAND_COLORS[Math.min(exp, 9)],
    '#c9a227',
  ];
}
