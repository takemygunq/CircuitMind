const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));

/** 0.0059 → "5.9 mA", 0.00004 → "40 µA", 1.2 → "1.2 A". Знак сохраняется. */
export function formatCurrent(amps: number): string {
  const a = Math.abs(amps);
  const sign = amps < 0 ? '−' : '';
  if (a < 1e-9) return '0 A';
  if (a >= 1) return `${sign}${trim(a, 2)} A`;
  if (a >= 1e-3) return `${sign}${trim(a * 1e3, a >= 0.1 ? 0 : a >= 0.01 ? 1 : 2)} mA`;
  return `${sign}${trim(a * 1e6, a >= 1e-4 ? 0 : 1)} µA`;
}

export function formatVoltage(volts: number): string {
  if (Math.abs(volts) < 5e-4) return '0 V';
  return `${trim(volts, Math.abs(volts) >= 10 ? 1 : 2)} V`.replace('-', '−');
}

export function formatPower(watts: number): string {
  const w = Math.abs(watts);
  if (w < 1e-6) return '0 W';
  if (w >= 1) return `${trim(w, 2)} W`;
  if (w >= 1e-3) return `${trim(w * 1e3, w >= 0.1 ? 0 : 1)} mW`;
  return `${trim(w * 1e6, 0)} µW`;
}

/** Длительность одного цикла бегущих штрихов, секунд: больше ток — быстрее (логарифмическая шкала). */
export function flowSeconds(amps: number): number {
  const mA = Math.abs(amps) * 1000;
  return Math.max(0.5, 2.4 / (0.6 + Math.log10(1 + mA)));
}
