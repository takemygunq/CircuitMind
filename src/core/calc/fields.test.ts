import { describe, expect, it } from 'vitest';
import { CALC_FIELDS, CALC_TYPES, calcSchemas, calculate, defaultInputs, unitFor } from './index';

describe('CALC_FIELDS', () => {
  it('covers every calculator', () => {
    expect(Object.keys(CALC_FIELDS).sort()).toEqual([...CALC_TYPES].sort());
  });
  it.each(CALC_TYPES)('%s: defaults are accepted by the calculator', (type) => {
    const r = calculate(type, defaultInputs(type));
    expect(Number.isFinite(r.result)).toBe(true);
  });
  it.each(CALC_TYPES.filter((t) => t !== 'current_budget'))(
    '%s: every field key exists in the Zod schema',
    (type) => {
      const shape = (calcSchemas[type] as unknown as { shape: Record<string, unknown> }).shape;
      for (const field of CALC_FIELDS[type]) expect(shape, field.key).toHaveProperty(field.key);
    },
  );
  it('knows units, including dynamic loads', () => {
    expect(unitFor('led_resistor', 'ifMa')).toBe('mA');
    expect(unitFor('current_budget', 'load:oled')).toBe('mA');
    expect(unitFor('i2c_pullup', 'busCapPf')).toBe('pF');
  });
});
