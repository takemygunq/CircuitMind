import { z } from 'zod';
import { Language, SimulatorKind } from './board';
import { BoardArt } from './art';
import { PinElectrical, PinFlag, PinFunction } from './pin';

/**
 * Черновик платы — формат, в котором ИИ описывает недостающую плату.
 * Намеренно «плоский» (без refine/default) для structured outputs, и без координат пинов:
 * пины задаются рядами (headers) с шагом, координаты считает `compileBoardDraft`.
 */
export const PinDraft = z.object({
  id: z.string(), // "GPIO21", "D13", "GP4"
  label: z.string(),
  functions: z.array(PinFunction),
  electrical: PinElectrical,
  voltage: z.number().nullable(),
  maxCurrentMa: z.number().nullable(),
  physicalPin: z.number().nullable(),
  flags: z.array(PinFlag),
  notes: z.array(z.string()),
  /** Пропуск перед пином в шагах (pitch). 0 — подряд. */
  gapBefore: z.number(),
});
export type PinDraft = z.infer<typeof PinDraft>;

export const HeaderDraft = z.object({
  name: z.string(), // "left", "top", "J1" — только для читаемости
  originX: z.number(), // центр первого пина, мм от левого верхнего угла платы
  originY: z.number(),
  direction: z.enum(['right', 'down']), // вдоль какой оси идут пины
  pitch: z.number(), // обычно 2.54
  pins: z.array(PinDraft),
});
export type HeaderDraft = z.infer<typeof HeaderDraft>;

export const BoardDraft = z.object({
  id: z.string(), // kebab-case: "arduino-nano"
  name: z.string(),
  aliases: z.array(z.string()),
  mcu: z.string(),
  logicVoltage: z.union([z.literal(3.3), z.literal(5)]),
  supplyMinV: z.number(),
  supplyMaxV: z.number(),
  supplyPinIds: z.array(z.string()),
  rails: z.array(
    z.object({
      pinId: z.string(),
      voltage: z.number(),
      maxCurrentMa: z.number(),
      note: z.string(),
    }),
  ),
  maxTotalCurrentMa: z.number().nullable(),
  languages: z.array(Language),
  simulator: SimulatorKind,
  widthMm: z.number(),
  heightMm: z.number(),
  headers: z.array(HeaderDraft),
  art: BoardArt,
  /** Источники, допущения, места где данные могут быть неточны. */
  notes: z.array(z.string()),
});
export type BoardDraft = z.infer<typeof BoardDraft>;
