import { z } from 'zod';
import { Size } from './board';
import { PinDef } from './pin';

export const ComponentCategory = z.enum([
  'passive',
  'led',
  'switch',
  'transistor',
  'diode',
  'sensor',
  'display',
  'actuator',
  'driver',
  'power',
  'module',
  'generic',
]);
export type ComponentCategory = z.infer<typeof ComponentCategory>;

export const ComponentDef = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1),
    category: ComponentCategory,
    /** Ключ электрической модели для ERC/симулятора: 'led', 'resistor', 'npn', 'nmos', ... */
    kind: z.string().optional(),
    description: z.string().optional(),
    /** Ключевые слова для поиска (en + ru): по ним ИИ находит компонент независимо от языка описания. */
    tags: z.array(z.string()).default([]),
    pins: z.array(PinDef).min(1),
    /** Vf, If, Vgs(th), Rds(on), ток потребления... Имена с суффиксами единиц (vfV, ifMaxMa). */
    params: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
    /** "wokwi:wokwi-led" | "svg:<имя файла в library/components>" */
    visual: z.string().regex(/^(wokwi|svg):.+/),
    size: Size,
    package: z.string().optional(), // корпус для BOM
    priceUsd: z.number().nonnegative().optional(), // примерная цена за штуку
    /** false — «generic»-компонент от ИИ, не проверенный в библиотеке. */
    verified: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    c.pins.forEach((p, i) => {
      if (ids.has(p.id))
        ctx.addIssue({
          code: 'custom',
          path: ['pins', i, 'id'],
          message: `duplicate pin id ${p.id}`,
        });
      ids.add(p.id);
    });
  });
export type ComponentDef = z.infer<typeof ComponentDef>;
