import { z } from 'zod';
import { PinFunction, Point } from './pin';

export const BOARD_REF = 'board';

/** "board:GPIO21" | "R1:1" | "led1:anode" */
export const ENDPOINT_RE = /^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z0-9_.+-]+$/;
export const Endpoint = z.string().regex(ENDPOINT_RE, 'endpoint must look like "ref:pin"');
export type Endpoint = z.infer<typeof Endpoint>;

export function parseEndpoint(endpoint: string): { ref: string; pin: string } {
  const i = endpoint.indexOf(':');
  return { ref: endpoint.slice(0, i), pin: endpoint.slice(i + 1) };
}

export const PartInstance = z.object({
  instanceId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  componentId: z.string().min(1),
  value: z.string().optional(), // "220", "10k"
  position: Point.optional(),
});
export type PartInstance = z.infer<typeof PartInstance>;

export const Connection = z.object({
  from: Endpoint,
  to: Endpoint,
  netName: z.string().optional(),
  color: z.string().optional(),
  signal: PinFunction.optional(),
});
export type Connection = z.infer<typeof Connection>;

export const Calculation = z.object({
  id: z.string().min(1),
  title: z.string(),
  formula: z.string(),
  inputs: z.record(z.string(), z.number()),
  result: z.number(),
  unit: z.string(),
  explanation: z.string(),
});
export type Calculation = z.infer<typeof Calculation>;

export const BomItem = z.object({
  componentId: z.string().min(1),
  qty: z.number().int().positive(),
  value: z.string().optional(),
  owned: z.boolean().optional(),
});
export type BomItem = z.infer<typeof BomItem>;

export const Warning = z.object({
  level: z.enum(['info', 'warning', 'danger']),
  text: z.string().min(1),
});
export type Warning = z.infer<typeof Warning>;

export const Project = z
  .object({
    title: z.string().min(1),
    description: z.string(),
    boardId: z.string().min(1),
    parts: z.array(PartInstance),
    connections: z.array(Connection),
    power: z.object({
      source: z.string(),
      voltage: z.number().positive(),
      budgetMa: z.number().nonnegative(),
    }),
    calculations: z.array(Calculation).default([]),
    bom: z.array(BomItem).default([]),
    warnings: z.array(Warning).default([]),
    codeHints: z
      .object({ libraries: z.array(z.string()), pinMap: z.record(z.string(), z.string()) })
      .optional(),
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    p.parts.forEach((part, i) => {
      if (part.instanceId === BOARD_REF)
        ctx.addIssue({
          code: 'custom',
          path: ['parts', i, 'instanceId'],
          message: '"board" is reserved',
        });
      if (ids.has(part.instanceId))
        ctx.addIssue({
          code: 'custom',
          path: ['parts', i, 'instanceId'],
          message: `duplicate instanceId ${part.instanceId}`,
        });
      ids.add(part.instanceId);
    });
    p.connections.forEach((c, i) => {
      for (const side of ['from', 'to'] as const) {
        const { ref } = parseEndpoint(c[side]);
        if (ref !== BOARD_REF && !ids.has(ref))
          ctx.addIssue({
            code: 'custom',
            path: ['connections', i, side],
            message: `unknown part "${ref}"`,
          });
      }
    });
  });
export type Project = z.infer<typeof Project>;
