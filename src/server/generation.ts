import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  AgentError,
  type AgentErrorCode,
  type AgentEvent,
  type AgentResult,
} from '@/ai/agent/events';
import { ProviderError } from '@/ai/providers/types';
import type { ModelClient } from '@/ai/agent/model-client';
import { runAgent, type AgentRequest } from '@/ai/agent/run';
import type { ToolContext } from '@/ai/agent/tools';

/** Кэш готовых успешных результатов (по хэшу запроса) с TTL и ограничением размера. */
export class ResultCache<V = AgentResult> {
  private readonly items = new Map<string, { at: number; value: V }>();
  constructor(
    private readonly ttlMs = 60 * 60_000,
    private readonly max = 50,
  ) {}
  get(key: string, now = Date.now()): V | undefined {
    const hit = this.items.get(key);
    if (!hit) return undefined;
    if (now - hit.at > this.ttlMs) {
      this.items.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V, now = Date.now()): void {
    this.items.delete(key);
    this.items.set(key, { at: now, value });
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value!);
  }
  get size() {
    return this.items.size;
  }
}

export function requestKey(req: AgentRequest, model: string): string {
  const norm = {
    prompt: req.prompt.trim().toLowerCase().replace(/\s+/g, ' '),
    boardId: req.boardId ?? '',
    locale: req.locale,
    seed: req.seed ?? null,
    inventory: req.inventory ?? null,
    model,
  };
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

/** Ошибка SDK / агента → код для клиента. */
export function toErrorEvent(e: unknown, timedOut = false): Extract<AgentEvent, { type: 'error' }> {
  if (e instanceof AgentError) return { type: 'error', code: e.code, message: e.message };
  if (timedOut) return { type: 'error', code: 'timeout', message: 'Generation took too long' };
  if (
    (e instanceof Error && e.name === 'AbortError') ||
    (e instanceof DOMException && e.name === 'AbortError')
  )
    return { type: 'error', code: 'aborted', message: 'Cancelled' };
  const msg = e instanceof Error ? e.message : String(e);
  let code: AgentErrorCode = 'ai_unavailable';
  if (
    e instanceof Anthropic.AuthenticationError ||
    e instanceof Anthropic.PermissionDeniedError ||
    /could not resolve authentication|api key|credential/i.test(msg)
  )
    code = 'ai_not_configured';
  else if (e instanceof ProviderError && (e.status === 401 || e.status === 403))
    code = 'ai_not_configured';
  else if (
    e instanceof Anthropic.RateLimitError ||
    (e instanceof ProviderError && e.status === 429)
  )
    code = 'ai_rate_limited';
  else if (e instanceof ProviderError) {
    console.error('[generation]', e);
    code = e.status === 400 ? 'invalid_request' : 'ai_unavailable';
  } else if (e instanceof Anthropic.BadRequestError) code = 'invalid_request';
  else console.error('[generation]', e);
  return {
    type: 'error',
    code,
    message:
      code === 'ai_not_configured'
        ? 'AI is not configured (set ANTHROPIC_API_KEY or connect a provider in Settings)'
        : msg.slice(0, 300),
  };
}

type Listener = (e: AgentEvent) => void;

/** Один запуск генерации. Можно подписаться несколько раз: поздние подписчики получают уже случившиеся события. */
export class GenerationRun {
  readonly events: AgentEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly abort = new AbortController();
  private viewers = 0;
  finished = false;
  timedOut = false;

  push(e: AgentEvent): void {
    this.events.push(e);
    if (e.type === 'done' || e.type === 'error') this.finished = true;
    for (const l of this.listeners) l(e);
  }

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  /** Подписка с воспроизведением истории. Возвращает функцию отписки; без зрителей незавершённый запуск отменяется. */
  subscribe(cb: Listener): () => void {
    this.viewers++;
    for (const e of this.events) cb(e);
    this.listeners.add(cb);
    return () => {
      if (!this.listeners.delete(cb)) return;
      if (--this.viewers === 0 && !this.finished) this.abort.abort();
    };
  }

  cancel(): void {
    this.abort.abort();
  }
}

export interface GenerationDeps {
  makeClient: (req: AgentRequest) => ModelClient;
  ctx: ToolContext;
  cache?: ResultCache;
  timeoutMs?: number;
  maxConcurrent?: number;
}

export class BusyError extends Error {}

export class GenerationService {
  private readonly active = new Map<string, GenerationRun>();
  private readonly cache: ResultCache;
  constructor(private readonly deps: GenerationDeps) {
    this.cache = deps.cache ?? new ResultCache();
  }

  get running(): number {
    return this.active.size;
  }

  /** Запускает генерацию (или отдаёт кэш / присоединяется к такому же идущему запуску). */
  start(req: AgentRequest): GenerationRun {
    const client = this.deps.makeClient(req);
    const key = requestKey(req, client.model);

    const cached = this.cache.get(key);
    if (cached) {
      const run = new GenerationRun();
      run.push({ type: 'start', model: client.model, cached: true });
      run.push({ type: 'done', result: { ...cached, cached: true } });
      return run;
    }
    const existing = this.active.get(key);
    if (existing) return existing;
    if (this.active.size >= (this.deps.maxConcurrent ?? 4))
      throw new BusyError('Too many generations are running');

    const run = new GenerationRun();
    this.active.set(key, run);
    const timer = setTimeout(
      () => {
        run.timedOut = true;
        run.cancel();
      },
      this.deps.timeoutMs ?? 5 * 60_000,
    );

    runAgent({
      client,
      ctx: this.deps.ctx,
      request: req,
      emit: (e) => run.push(e),
      signal: run.signal,
    })
      .then((result) => {
        if (result.ok) this.cache.set(key, result);
        run.push({ type: 'done', result });
      })
      .catch((e) => run.push(toErrorEvent(e, run.timedOut)))
      .finally(() => {
        clearTimeout(timer);
        this.active.delete(key);
      });
    return run;
  }
}
