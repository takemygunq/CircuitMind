import { describe, expect, it } from 'vitest';
import { getBoard } from '@/core/library';
import { GROUP_COLORS, primaryGroup, wireColor } from './colors';

describe('primaryGroup', () => {
  const esp = getBoard('esp32-devkit-v1')!;
  const pin = (id: string) => esp.pins.find((p) => p.id === id)!;
  it('prefers specialised functions over plain GPIO', () => {
    expect(primaryGroup(pin('GPIO21'))).toBe('i2c');
    expect(primaryGroup(pin('GPIO34'))).toBe('adc');
    expect(primaryGroup(pin('3V3'))).toBe('power');
    expect(primaryGroup(pin('GND1'))).toBe('gnd');
  });
  it('has a colour for every group', () => {
    for (const c of Object.values(GROUP_COLORS)) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('wireColor', () => {
  it('uses explicit names and hex', () => {
    expect(wireColor({ color: 'red' })).toBe('#e63946');
    expect(wireColor({ color: '#123456' })).toBe('#123456');
  });
  it('falls back to signal, then pin function, then green', () => {
    expect(wireColor({ signal: 'i2c_sda' })).toBe('#3b82f6');
    expect(wireColor({}, [{ functions: ['gnd'] }])).toBe('#2b2d31');
    expect(wireColor({ color: 'chartreuse' })).toBe('#2fb344');
  });
});
