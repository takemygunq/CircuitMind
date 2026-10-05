import { z } from 'zod';

export const Side = z.enum(['left', 'right', 'top', 'bottom']);
export type Side = z.infer<typeof Side>;

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * Декоративные элементы платы. Все координаты — в мм, центр элемента, ось Y вниз.
 * Рендерит их только наш детерминированный движок (`src/diagram/board-art`), SVG никто не пишет вручную.
 */
export const ArtPart = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('usb'),
    variant: z.enum(['micro', 'mini', 'usb-b', 'usb-c']),
    side: Side, // в какую сторону смотрит разъём (где вставляется кабель)
    x: z.number(),
    y: z.number(),
  }),
  z.object({ type: z.literal('barrel'), side: Side, x: z.number(), y: z.number() }),
  z.object({
    type: z.literal('chip'),
    package: z.enum(['qfp', 'qfn', 'dip', 'soic', 'sot']),
    label: z.string(),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }),
  z.object({
    type: z.literal('module'), // экранированный модуль, например ESP32-WROOM
    label: z.string(),
    antenna: z.boolean(), // верхняя часть — печатная антенна
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }),
  z.object({
    type: z.literal('button'),
    label: z.string(),
    color: HexColor,
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    type: z.literal('led'),
    label: z.string(),
    color: HexColor,
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    type: z.literal('crystal'),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }),
  z.object({
    type: z.literal('smd'),
    kind: z.enum(['resistor', 'capacitor', 'inductor']),
    label: z.string(),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }),
  z.object({
    type: z.literal('header'), // дополнительная гребёнка без подписей (ICSP, SWD)
    cols: z.number().int(),
    rows: z.number().int(),
    pitch: z.number(),
    x: z.number(), // центр первого штыря
    y: z.number(),
  }),
  z.object({
    type: z.literal('text'),
    text: z.string(),
    size: z.number(),
    rotate: z.number(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({ type: z.literal('hole'), d: z.number(), x: z.number(), y: z.number() }),
]);
export type ArtPart = z.infer<typeof ArtPart>;

export const BoardArt = z.object({
  pcbColor: HexColor,
  silkColor: HexColor,
  /** 'header' — штыри в пластиковых гребёнках; 'castellated' — контактные площадки по краю (Pico). */
  pinStyle: z.enum(['header', 'castellated']),
  parts: z.array(ArtPart),
});
export type BoardArt = z.infer<typeof BoardArt>;
