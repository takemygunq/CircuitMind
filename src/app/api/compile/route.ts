import { z } from 'zod';
import { MAX_FIRMWARE_CHARS } from '@/core/code';
import { FQBN_BY_BOARD, fqbnFor, supportedFqbns } from '@/server/compile/fqbn';
import { getCompileService } from '@/server/compile/instance';
import { CompileBusyError, CompilerUnavailableError } from '@/server/compile/service';
import { RateLimiter } from '@/server/rate-limit';

const Body = z.object({
  code: z.string().min(10).max(MAX_FIRMWARE_CHARS),
  boardId: z.string().min(1).max(80),
});
export const compileLimiter = new RateLimiter(10, 10 * 60_000);

/** Какие платы можно скомпилировать на этом сервере (Docker запущен, образ собран, ядро установлено). */
export async function GET() {
  const available = await getCompileService().available();
  const boards = available ? Object.keys(FQBN_BY_BOARD).filter((id) => fqbnFor(id)) : [];
  return Response.json({ available, boards, fqbns: supportedFqbns() });
}

/** Компиляция скетча Arduino в песочнице Docker (без сети, read-only, лимиты). Возвращает HEX и диагностику. */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!compileLimiter.take(ip))
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return Response.json(
      { error: 'invalid_request', issues: body.error.issues.slice(0, 5) },
      { status: 400 },
    );
  const fqbn = fqbnFor(body.data.boardId);
  if (!fqbn)
    return Response.json(
      { error: 'compile_unsupported', boardId: body.data.boardId, supported: supportedFqbns() },
      { status: 400 },
    );

  try {
    const result = await getCompileService().compile({ fqbn, code: body.data.code });
    return Response.json(result);
  } catch (e) {
    if (e instanceof CompilerUnavailableError)
      return Response.json({ error: 'compiler_unavailable' }, { status: 503 });
    if (e instanceof CompileBusyError)
      return Response.json({ error: 'busy' }, { status: 503, headers: { 'Retry-After': '15' } });
    console.error('[compile]', e);
    return Response.json({ error: 'compile_failed' }, { status: 500 });
  }
}
