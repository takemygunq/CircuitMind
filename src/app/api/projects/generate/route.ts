import { z } from 'zod';
import type { AgentEvent } from '@/ai/agent/events';
import { Inventory } from '@/core/inventory';
import { Project } from '@/core/schema';
import { getAnyBoard } from '@/server/board-service';
import { BusyError, toErrorEvent, type GenerationRun } from '@/server/generation';
import { generationLimiter, getGenerationService } from '@/server/generation-instance';

const Body = z.object({
  prompt: z.string().trim().min(8).max(1500),
  boardId: z.string().trim().max(80).optional(),
  locale: z.enum(['ru', 'uk', 'en']).default('ru'),
  seed: Project.optional(),
  inventory: Inventory.optional(),
});

const encoder = new TextEncoder();
const line = (e: AgentEvent) => encoder.encode(JSON.stringify(e) + '\n');

/**
 * Режим 1: «Хочу устройство». Отвечает потоком NDJSON — по событию на строку
 * (start, turn, tool, erc, repair, done | error). Пустые строки — heartbeat.
 */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!generationLimiter.take(ip))
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return Response.json({ error: 'invalid_request', issues: body.error.issues }, { status: 400 });
  const { prompt, boardId, locale, seed, inventory } = body.data;
  if (boardId && !(await getAnyBoard(boardId)))
    return Response.json({ error: 'unknown_board', boardId }, { status: 400 });

  let run: GenerationRun;
  try {
    run = getGenerationService().start({ prompt, boardId, locale, seed, inventory });
  } catch (e) {
    if (e instanceof BusyError)
      return Response.json({ error: 'busy' }, { status: 503, headers: { 'Retry-After': '30' } });
    const err = toErrorEvent(e);
    return Response.json(
      { error: err.code, message: err.message },
      { status: err.code === 'ai_not_configured' ? 503 : 502 },
    );
  }

  let off = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        off();
        try {
          controller.close();
        } catch {
          /* поток уже закрыт клиентом */
        }
      };
      ping = setInterval(() => !closed && controller.enqueue(encoder.encode('\n')), 15_000);
      off = run.subscribe((e) => {
        if (closed) return;
        controller.enqueue(line(e));
        if (e.type === 'done' || e.type === 'error') queueMicrotask(close);
      });
      req.signal.addEventListener('abort', close);
    },
    cancel() {
      clearInterval(ping);
      off();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
