import { createHash } from 'node:crypto';
import type { ModelClient } from '@/ai/agent/model-client';
import type { CodeEvent, CodeResult } from '@/ai/code/events';
import { runCodeAgent, type CodeRequest } from '@/ai/code/run';
import { BusyError, ResultCache, toErrorEvent } from './generation';

export interface CodeServiceDeps {
  makeClient: (req: CodeRequest) => ModelClient;
  cache?: ResultCache<CodeResult>;
  timeoutMs?: number;
  maxConcurrent?: number;
}

export function codeRequestKey(req: CodeRequest, model: string): string {
  const norm = {
    project: req.project,
    board: req.board.id,
    language: req.language,
    locale: req.locale,
    mode: req.mode,
    code: req.code ?? '',
    instruction: req.instruction ?? '',
    model,
  };
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

/** Запуск генерации/правки/объяснения кода. Кэшируются только успешные результаты (одинаковый запрос = тот же код). */
export class CodeService {
  private running = 0;
  private readonly cache: ResultCache<CodeResult>;
  constructor(private readonly deps: CodeServiceDeps) {
    this.cache = deps.cache ?? new ResultCache<CodeResult>();
  }

  async run(req: CodeRequest, emit: (e: CodeEvent) => void, signal: AbortSignal): Promise<void> {
    const client = this.deps.makeClient(req);
    const key = codeRequestKey(req, client.model);
    // правка и объяснение зависят от кода пользователя — тоже входят в ключ, поэтому кэш безопасен для всех режимов
    const hit = this.cache.get(key);
    if (hit) {
      emit({ type: 'start', mode: req.mode, model: client.model, cached: true });
      emit({ type: 'done', result: { ...hit, cached: true } });
      return;
    }
    if (this.running >= (this.deps.maxConcurrent ?? 4))
      throw new BusyError('Too many code requests are running');

    this.running++;
    const timeout = AbortSignal.timeout(this.deps.timeoutMs ?? 4 * 60_000);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      const result = await runCodeAgent({ client, request: req, emit, signal: combined });
      if (result.ok) this.cache.set(key, result);
      emit({ type: 'done', result });
    } catch (e) {
      emit(toErrorEvent(e, timeout.aborted && !signal.aborted));
    } finally {
      this.running--;
    }
  }
}
