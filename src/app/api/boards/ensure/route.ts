import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { BoardGenerationError } from '@/ai/board-generator';
import { ProviderError } from '@/ai/providers/types';
import { ensureBoardServer } from '@/server/board-service';
import { RateLimiter } from '@/server/rate-limit';

const Body = z.object({ query: z.string().trim().min(2).max(100) });
const limiter = new RateLimiter(5, 60_000); // генерация платы стоит денег

/** Находит плату в библиотеке или просит ИИ описать её, сохраняет в library/generated и возвращает. */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!limiter.take(ip))
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return Response.json({ error: 'invalid_request', issues: body.error.issues }, { status: 400 });

  try {
    const { status, board, warnings, attempts } = await ensureBoardServer(body.data.query);
    return Response.json({ status, board, warnings, attempts });
  } catch (e) {
    if (e instanceof BoardGenerationError)
      return Response.json(
        { error: 'generation_failed', message: e.message, problems: e.problems },
        { status: 422 },
      );
    if (
      e instanceof Anthropic.AuthenticationError ||
      (e instanceof ProviderError && (e.status === 401 || e.status === 403)) ||
      (e instanceof Error && /credentials|api key|auth/i.test(e.message))
    )
      return Response.json({ error: 'ai_not_configured' }, { status: 503 });
    if (e instanceof Anthropic.RateLimitError)
      return Response.json(
        { error: 'ai_rate_limited' },
        { status: 503, headers: { 'Retry-After': '30' } },
      );
    console.error('[boards/ensure]', e);
    return Response.json({ error: 'ai_unavailable' }, { status: 502 });
  }
}
