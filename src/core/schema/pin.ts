import { z } from 'zod';

export const PinFunction = z.enum([
  'power',
  'gnd',
  'gpio',
  'adc',
  'dac',
  'pwm',
  'i2c_sda',
  'i2c_scl',
  'spi_mosi',
  'spi_miso',
  'spi_sck',
  'spi_cs',
  'uart_tx',
  'uart_rx',
  'touch',
  'other',
]);
export type PinFunction = z.infer<typeof PinFunction>;

/** Электрическая роль пина — нужна ERC и симулятору. */
export const PinElectrical = z.enum([
  'passive',
  'input',
  'output',
  'bidirectional',
  'power_in',
  'power_out',
  'gnd',
]);
export type PinElectrical = z.infer<typeof PinElectrical>;

/** Машиночитаемые ограничения пина (для ERC); человекочитаемые пояснения — в `notes`. */
export const PinFlag = z.enum(['input_only', 'strapping', 'flash', 'adc2', 'boot', 'reserved']);
export type PinFlag = z.infer<typeof PinFlag>;

export const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

export const PinDef = z.object({
  id: z.string().min(1), // "GPIO21", "D13", "VCC"
  label: z.string().min(1),
  functions: z.array(PinFunction).min(1),
  electrical: PinElectrical.optional(),
  voltage: z.number().nonnegative().optional(), // логический уровень / напряжение питания, В
  maxCurrentMa: z.number().positive().optional(),
  /** Допустимое напряжение на входе, В. По умолчанию — логический уровень платы + 0.3 В. */
  maxInputV: z.number().positive().optional(),
  /** Минимальное напряжение, которое вход считает логической «1», В. */
  minHighV: z.number().positive().optional(),
  /** Пин модуля, от напряжения которого зависит логический уровень этого пина ("VCC", "LV", "HV"). */
  referenceSupply: z.string().optional(),
  /** Аналоговый сигнал (движок потенциометра, выход датчика) — важно для ADC2 при Wi-Fi. */
  analog: z.boolean().optional(),
  physicalPin: z.number().int().positive().optional(), // номер на гребёнке (Pico, RPi)
  flags: z.array(PinFlag).default([]),
  notes: z.array(z.string()).default([]),
  /** Координаты в мм в системе координат изделия (плата или компонент). */
  position: Point,
});
export type PinDef = z.infer<typeof PinDef>;
