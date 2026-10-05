export type Severity = 'danger' | 'error' | 'warning' | 'info';

export const RULES = [
  'unknown_board',
  'unknown_component',
  'unknown_pin',
  'unverified_component',
  'short_circuit',
  'multiple_drivers',
  'unconnected_required',
  'function_mismatch',
  'input_only_as_output',
  'flash_pin_used',
  'strapping_pin_used',
  'adc2_wifi',
  'level_overvoltage',
  'level_undervoltage',
  'pin_overcurrent',
  'gpio_total_overcurrent',
  'rail_overload',
  'power_budget',
  'high_current_from_rail',
  'supply_out_of_range',
  'part_supply_voltage',
  'led_no_resistor',
  'led_overcurrent',
  'base_no_resistor',
  'transistor_saturation',
  'transistor_overload',
  'mosfet_logic_level',
  'inductive_no_flyback',
  'flyback_diode_reversed',
  'inductive_direct_gpio',
  'mains_warning',
  'missing_mains_warning',
  'missing_pullup',
  'pullup_value',
  'i2c_pullup_missing',
  'i2c_address_conflict',
  'invalid_value',
  'nonstandard_value',
  'calc_mismatch',
  'calc_invalid',
] as const;
export type RuleId = (typeof RULES)[number];

/** Нарушение: машиночитаемо (rule + params), текст строится по словарю i18n. */
export interface Violation {
  rule: RuleId;
  severity: Severity;
  /** Endpoint'ы ("board:D13", "R1:1") или instanceId деталей, к которым относится нарушение. */
  refs: string[];
  params: Record<string, string | number>;
}

export interface ErcReport {
  violations: Violation[];
  counts: Record<Severity, number>;
  /** true, если нет error. danger (опасное напряжение), warning и info не блокируют, но показываются пользователю. */
  ok: boolean;
}
