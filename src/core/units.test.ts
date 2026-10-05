import { describe, expect, it } from 'vitest';
import { formatOhms, parseOhms, resistorBands } from './units';

describe('parseOhms', () => {
  it.each([
    ['220', 220],
    ['4.7k', 4700],
    ['4k7', 4700],
    ['10K', 10000],
    ['1M', 1e6],
    ['100R', 100],
    ['2,2k', 2200],
    ['330 Ω', 330],
  ])('%s → %d', (s, v) => expect(parseOhms(s)).toBe(v));

  it('returns NaN for garbage', () => {
    expect(parseOhms('abc')).toBeNaN();
    expect(parseOhms('')).toBeNaN();
  });
});

describe('formatOhms', () => {
  it('formats with SI prefixes', () => {
    expect(formatOhms(220)).toBe('220 Ω');
    expect(formatOhms(4700)).toBe('4.7 kΩ');
    expect(formatOhms(1e6)).toBe('1 MΩ');
  });
});

describe('resistorBands', () => {
  const [red, violet, brown, orange, yellow, black, gold] = [
    '#d62828',
    '#8e44ad',
    '#7b4a21',
    '#f77f00',
    '#f2d400',
    '#111111',
    '#c9a227',
  ];
  it('220 Ω = red red brown gold', () =>
    expect(resistorBands(220)).toEqual([red, red, brown, gold]));
  it('4.7 kΩ = yellow violet red gold', () =>
    expect(resistorBands(4700)).toEqual([yellow, violet, red, gold]));
  it('10 kΩ = brown black orange gold', () =>
    expect(resistorBands(10000)).toEqual([brown, black, orange, gold]));
  it('330 Ω = orange orange brown gold', () =>
    expect(resistorBands(330)).toEqual([orange, orange, brown, gold]));
});
