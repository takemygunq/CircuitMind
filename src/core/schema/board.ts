import { z } from 'zod';
import { BoardArt } from './art';
import { PinDef } from './pin';

export const Language = z.enum(['arduino', 'micropython', 'circuitpython', 'esp-idf', 'python']);
export type Language = z.infer<typeof Language>;

export const SimulatorKind = z.enum(['avr8js', 'rp2040js', 'behavioral', 'none']);
export type SimulatorKind = z.infer<typeof SimulatorKind>;

export const Size = z.object({ width: z.number().positive(), height: z.number().positive() });
export type Size = z.infer<typeof Size>;

/** Выход питания платы (5V, 3V3) с лимитом тока — для бюджета тока. */
export const PowerRail = z.object({
  pinId: z.string(),
  voltage: z.number().positive(),
  maxCurrentMa: z.number().positive(),
  note: z.string().optional(),
});
export type PowerRail = z.infer<typeof PowerRail>;

export const BoardDef = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1),
    /** Альтернативные названия для поиска («nodemcu», «uno r3»). */
    aliases: z.array(z.string()).default([]),
    mcu: z.string().min(1),
    /** Периферия (I2C/SPI/UART) можно назначить на любые пины через матрицу (ESP32). */
    flexibleMux: z.boolean().default(false),
    logicVoltage: z.union([z.literal(3.3), z.literal(5)]),
    supply: z.object({ min: z.number(), max: z.number(), pins: z.array(z.string()).min(1) }),
    rails: z.array(PowerRail).default([]),
    pins: z.array(PinDef).min(1),
    maxTotalCurrentMa: z.number().positive().optional(),
    /** Типовое собственное потребление платы (МК, регулятор, USB-чип), мА — для бюджета питания. */
    selfCurrentMa: z.number().nonnegative().optional(),
    /** Примерная цена платы, USD (для BOM). */
    priceUsd: z.number().nonnegative().optional(),
    languages: z.array(Language).min(1),
    simulator: SimulatorKind.default('none'),
    /** Габариты платы, мм. Контур и пины рисует движок по `size` и `pins[].position`. */
    size: Size,
    /** Параметры реалистичного вида; SVG рисует `renderBoardSvg`. Без art — упрощённый вид. */
    art: BoardArt.optional(),
    /** false — плата сгенерирована ИИ и не сверена с даташитом; UI помечает её как непроверенную. */
    verified: z.boolean().default(true),
    source: z.enum(['builtin', 'ai']).default('builtin'),
    generatedAt: z.string().optional(),
    /** Допущения и сомнения ИИ при составлении распиновки. */
    provenance: z.array(z.string()).default([]),
  })
  .superRefine((b, ctx) => {
    const ids = new Set<string>();
    b.pins.forEach((p, i) => {
      if (ids.has(p.id))
        ctx.addIssue({
          code: 'custom',
          path: ['pins', i, 'id'],
          message: `duplicate pin id ${p.id}`,
        });
      ids.add(p.id);
      if (
        p.position.x < 0 ||
        p.position.x > b.size.width ||
        p.position.y < 0 ||
        p.position.y > b.size.height
      )
        ctx.addIssue({
          code: 'custom',
          path: ['pins', i, 'position'],
          message: `pin ${p.id} is outside the board`,
        });
    });
    b.supply.pins.forEach((id, i) => {
      if (!ids.has(id))
        ctx.addIssue({
          code: 'custom',
          path: ['supply', 'pins', i],
          message: `unknown supply pin ${id}`,
        });
    });
    b.rails.forEach((r, i) => {
      if (!ids.has(r.pinId))
        ctx.addIssue({
          code: 'custom',
          path: ['rails', i, 'pinId'],
          message: `unknown rail pin ${r.pinId}`,
        });
    });
  });
export type BoardDef = z.infer<typeof BoardDef>;
