import { describe, expect, it } from 'vitest';
import { blinkUno, weatherEsp32 } from '../fixtures';
import { analyzeCircuit } from './analysis';

describe('analyzeCircuit', () => {
  it('reports the power balance of the weather station', () => {
    const a = analyzeCircuit(weatherEsp32)!;
    expect(a.power.selfMa).toBe(80);
    const rail = a.power.rails.find((r) => r.pin === '3V3')!;
    expect(rail.voltage).toBe(3.3);
    expect(rail.ma).toBeCloseTo(1.5 + 20 + 3.3 / 4.7, 1); // DHT22 + OLED + подтяжка
    expect(rail.limitMa).toBe(500);
    expect(a.power.totalMa).toBeCloseTo(
      a.power.selfMa + a.power.gpioTotalMa + a.power.rails.reduce((s, r) => s + r.ma, 0),
      6,
    );
    expect(a.power.budgetMa).toBe(500);
  });
  it('reports GPIO loads and LED currents', () => {
    const a = analyzeCircuit(weatherEsp32)!;
    const led = a.power.gpio.find((p) => p.pin === 'GPIO18')!;
    expect(led.sourceMa).toBeCloseTo((3.3 - 2) / 0.22, 1);
    expect(led.limitMa).toBe(12);
    expect(a.leds).toEqual([
      { part: 'led1', ma: expect.closeTo(5.91, 1), limitMa: 20, hasResistor: true },
    ]);
  });
  it('works for the Uno blink example', () => {
    const a = analyzeCircuit(blinkUno)!;
    expect(a.leds[0].ma).toBeCloseTo(20, 1);
    expect(a.power.gpio[0]).toMatchObject({ pin: 'D13', limitMa: 20 });
  });
  it('returns undefined for unknown boards', () => {
    expect(analyzeCircuit({ ...weatherEsp32, boardId: 'nope' })).toBeUndefined();
  });
});
