import { describe, expect, it } from 'vitest';
import { flowSeconds, formatCurrent, formatPower, formatVoltage } from './format';

describe('formatCurrent', () => {
  it.each([
    [0.0059, '5.9 mA'],
    [0.02, '20 mA'],
    [0.00123, '1.23 mA'],
    [0.00004, '40 µA'],
    [0.0000003, '0.3 µA'],
    [0.25, '250 mA'],
    [1.5, '1.5 A'],
    [0, '0 A'],
    [-0.0059, '−5.9 mA'],
  ])('%d → %s', (a, s) => expect(formatCurrent(a)).toBe(s));
});

describe('formatVoltage / formatPower', () => {
  it('formats volts', () => {
    expect(formatVoltage(3.2951)).toBe('3.3 V');
    expect(formatVoltage(5)).toBe('5 V');
    expect(formatVoltage(0.0001)).toBe('0 V');
    expect(formatVoltage(-1.5)).toBe('−1.5 V');
    expect(formatVoltage(12.34)).toBe('12.3 V');
  });
  it('formats watts', () => {
    expect(formatPower(0.0077)).toBe('7.7 mW');
    expect(formatPower(0.25)).toBe('250 mW');
    expect(formatPower(2.5)).toBe('2.5 W');
    expect(formatPower(0.00002)).toBe('20 µW');
  });
});

describe('flowSeconds', () => {
  it('speeds up with current but stays within sane bounds', () => {
    expect(flowSeconds(0.001)).toBeGreaterThan(flowSeconds(0.02));
    expect(flowSeconds(0.02)).toBeGreaterThan(flowSeconds(0.5));
    expect(flowSeconds(100)).toBeGreaterThanOrEqual(0.5);
    expect(flowSeconds(-0.02)).toBe(flowSeconds(0.02));
  });
});
