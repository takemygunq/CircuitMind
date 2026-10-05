import { z } from 'zod';
import { handle } from '@/server/providers/http';
import { deleteProvider, getProvider, updateProvider } from '@/server/providers/store';

type Ctx = { params: Promise<{ id: string }> };

const Patch = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  apiKey: z.string().trim().min(1).max(500).optional(),
  baseUrl: z.string().trim().max(500).nullable().optional(),
  models: z
    .array(
      z.object({ id: z.string().trim().min(1).max(200), label: z.string().max(200).optional() }),
    )
    .max(1000)
    .optional(),
  defaultModel: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export const GET = async (req: Request, { params }: Ctx) =>
  handle(req, async () => ({ provider: getProvider((await params).id) }));

export const PATCH = async (req: Request, { params }: Ctx) =>
  handle(req, async () => ({
    provider: updateProvider((await params).id, Patch.parse(await req.json())),
  }));

export const DELETE = async (req: Request, { params }: Ctx) =>
  handle(req, async () => {
    deleteProvider((await params).id);
    return { ok: true };
  });
