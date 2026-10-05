import { describe, expect, it } from 'vitest';
import { en } from './en';
import { translate } from './index';
import { ru } from './ru';
import { uk } from './uk';

describe('i18n', () => {
  it('has identical keys in ru / uk / en', () => {
    expect(Object.keys(uk).sort()).toEqual(Object.keys(ru).sort());
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  });

  it('has no empty strings and keeps {placeholders} in sync', () => {
    for (const [key, text] of Object.entries(ru)) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      for (const dict of [uk, en] as Record<string, string>[]) {
        expect(dict[key], key).toBeTruthy();
        expect(vars(dict[key]), key).toBe(vars(text));
      }
    }
  });

  it('interpolates variables', () => {
    expect(translate('en', 'pinout.usedCount', { n: 7 })).toBe('Pins in use: 7');
  });
});
