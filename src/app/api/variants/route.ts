import { z } from 'zod';
import { createMockVariantsClient } from '@/ai/variants/mock';
import type { VariantsEvent } from '@/ai/variants/events';
import { Inventory } from '@/core/inventory';
import { boardStore } from '@/server/board-service';
import { BusyError, toErrorEvent } from '@/server/generation';
import { resolveModel } from '@/server/providers/resolve';
import { ndjsonResponse } from '@/server/ndjson-stream';
import { RateLimiter } from '@/server/rate-limit';
import { VariantsService } from '@/server/variants-service';

const MAX_BODY_BYTES = 40_000;
const Body = z.object({
  inventory: Inventory,
  wish: z.string().trim().max(600).optional(),
  locale: z.enum(['ru', 'uk', 'en']).default('ru'),
});

export const variantsLimiter = new RateLimiter(4, 10 * 60_000);

let service: VariantsService | undefined;
const getService = () =>
  (service ??= new VariantsService({
    makeClient: () => resolveModel({ mock: createMockVariantsClient, maxTokens: 32_000 }).client,
    ctx: { store: boardStore },
  }));

/** Режим 2: инвентарь → варианты устройств. Поток NDJSON событий VariantsEvent. */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!variantsLimiter.take(ip))
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: 'too_large' }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  const body = Body.safeParse(json);
  if (!body.success)
    return Response.json(
      { error: 'invalid_request', issues: body.error.issues.slice(0, 5) },
      { status: 400 },
    );
  if (body.data.inventory.items.length === 0)
    return Response.json({ error: 'empty_inventory' }, { status: 400 });

  return ndjsonResponse<VariantsEvent>(req, async (emit, signal) => {
    try {
      await getService().run(body.data, emit, signal);
    } catch (e) {
      emit(
        e instanceof BusyError
          ? { type: 'error', code: 'ai_unavailable', message: 'busy' }
          : toErrorEvent(e),
      );
    }
  });
}
