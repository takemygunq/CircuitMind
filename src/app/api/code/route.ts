import { z } from 'zod';
import { createMockCodeClient } from '@/ai/code/mock';
import { splitFirmware, type CodeRequest } from '@/ai/code/run';
import { MAX_FIRMWARE_CHARS } from '@/core/code';
import { Language, Project } from '@/core/schema';
import { getAnyBoard } from '@/server/board-service';
import { CodeService } from '@/server/code-service';
import { BusyError, toErrorEvent } from '@/server/generation';
import { resolveModel } from '@/server/providers/resolve';
import { ndjsonResponse } from '@/server/ndjson-stream';
import { RateLimiter } from '@/server/rate-limit';
import type { CodeEvent } from '@/ai/code/events';

const MAX_BODY_BYTES = 400_000;
const Body = z.object({
  action: z.enum(['generate', 'edit', 'explain']),
  project: Project,
  language: Language,
  locale: z.enum(['ru', 'uk', 'en']).default('ru'),
  code: z.string().max(MAX_FIRMWARE_CHARS).optional(),
  instruction: z.string().trim().max(1200).optional(),
});

export const codeLimiter = new RateLimiter(20, 10 * 60_000);

let service: CodeService | undefined;
const getService = () =>
  (service ??= new CodeService({
    makeClient: (r) =>
      resolveModel({
        maxTokens: 24_000,
        mock: () =>
          createMockCodeClient({
            project: r.project,
            board: r.board,
            language: r.language,
            mode: r.mode,
            currentBody: r.code ? splitFirmware(r.code).body : undefined,
            instruction: r.instruction,
          }),
      }).client,
  }));

/** Вкладка «Код»: generate (генерация), edit (правка по запросу), explain (объяснение). Поток NDJSON событий CodeEvent. */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!codeLimiter.take(ip))
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
  const { action, project, language, locale, code, instruction } = body.data;

  const board = await getAnyBoard(project.boardId);
  if (!board)
    return Response.json({ error: 'unknown_board', boardId: project.boardId }, { status: 400 });
  if (!board.languages.includes(language))
    return Response.json(
      { error: 'unsupported_language', supported: board.languages },
      { status: 400 },
    );

  const request: CodeRequest = {
    mode: action,
    project,
    board,
    language,
    locale,
    code,
    instruction,
  };
  return ndjsonResponse<CodeEvent>(req, async (emit, signal) => {
    try {
      await getService().run(request, emit, signal);
    } catch (e) {
      emit(
        e instanceof BusyError
          ? { type: 'error', code: 'ai_unavailable', message: 'busy' }
          : toErrorEvent(e),
      );
    }
  });
}
