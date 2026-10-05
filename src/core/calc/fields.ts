import type { CalcType } from './index';

/** Описание полей калькуляторов для форм: ключ, единица, значение по умолчанию. */
export interface CalcField {
  key: string;
  unit: string;
  default: number;
  optional?: boolean;
}

const f = (key: string, unit: string, def: number, optional = false): CalcField => ({
  key,
  unit,
  default: def,
  ...(optional && { optional }),
});
const series = f('series', 'E12/E24', 24, true);

export const CALC_FIELDS: Record<CalcType, CalcField[]> = {
  led_resistor: [f('vccV', 'V', 5), f('vfV', 'V', 2), f('ifMa', 'mA', 10), series],
  bjt_base_resistor: [
    f('vdriveV', 'V', 3.3),
    f('icMa', 'mA', 100),
    f('hfeMin', '', 100, true),
    f('forcedBeta', '', 10, true),
    f('vbeV', 'V', 0.7, true),
    series,
  ],
  voltage_divider: [f('vinV', 'V', 5), f('r1Ohm', 'Ω', 10000), f('r2Ohm', 'Ω', 20000)],
  divider_design: [f('vinV', 'V', 5), f('voutV', 'V', 3.3), f('r2Ohm', 'Ω', 10000, true), series],
  i2c_pullup: [
    f('vccV', 'V', 3.3),
    f('busCapPf', 'pF', 100),
    f('speedKhz', 'kHz', 100),
    f('sinkMa', 'mA', 3, true),
    series,
  ],
  pull_resistor: [f('vccV', 'V', 3.3), f('maxCurrentMa', 'mA', 0.5, true), series],
  mosfet_logic_level: [
    f('vgsDriveV', 'V', 3.3),
    f('vgsThMaxV', 'V', 2),
    f('rdsOnOhm', 'Ω', 0.022, true),
    f('rdsOnAtVgsV', 'V', 5, true),
    f('loadCurrentA', 'A', 3, true),
  ],
  current_budget: [
    f('sourceMa', 'mA', 500),
    f('reserve', '', 0.2, true),
    f('load:board', 'mA', 80),
    f('load:sensor', 'mA', 20),
  ],
  battery_life: [
    f('capacityMah', 'mAh', 2000),
    f('activeMa', 'mA', 80),
    f('sleepMa', 'mA', 0.01, true),
    f('duty', '0–1', 0.01, true),
    f('usableFraction', '0–1', 0.8, true),
  ],
  level_check: [f('driverV', 'V', 5), f('receiverMaxV', 'V', 3.6), f('receiverVihMinV', 'V', 2.3)],
};

export const unitFor = (type: CalcType, key: string): string =>
  CALC_FIELDS[type].find((x) => x.key === key)?.unit ?? (key.startsWith('load:') ? 'mA' : '');

/** Значения по умолчанию (только обязательные + необязательные с типовыми значениями). */
export function defaultInputs(type: CalcType): Record<string, number> {
  return Object.fromEntries(
    CALC_FIELDS[type]
      .filter((x) => !x.optional || x.key === 'reserve')
      .map((x) => [x.key, x.default]),
  );
}
