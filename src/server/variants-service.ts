import { createHash } from 'node:crypto';
import type { ModelClient } from '@/ai/agent/model-client';
import type { ToolContext } from '@/ai/agent/tools';
import type { VariantsEvent, VariantsResult } from '@/ai/variants/events';
import { runVariantsAgent, type VariantsRequest } from '@/ai/variants/run';
import { itemKey } from '@/core/inventory';
import { BusyError, ResultCache, toErrorEvent } from './generation';

export interface VariantsServiceDeps {
  makeClient: () => ModelClient;
  ctx: ToolContext;
  cache?: ResultCache<VariantsResult>;
  timeoutMs?: number;
  maxConcurrent?: number;
}

export function variantsRequestKey(req: VariantsRequest, model: string): string {
  const norm = {
    items: req.inventory.items.map((i) => `${itemKey(i)}×${i.qty}`).sort(),
    unknown: [...req.inventory.unknown].sort(),
    wish: (req.wish ?? '').trim().toLowerCase().replace(/\s+/g, ' '),
    locale: req.locale,
    model,
  };
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

/** Подбор вариантов по запасам: кэш успешных результатов и лимит параллельных запусков. */
export class VariantsService {
  private running = 0;
  private readonly cache: ResultCache<VariantsResult>;
  constructor(private readonly deps: VariantsServiceDeps) {
    this.cache = deps.cache ?? new ResultCache<VariantsResult>();
  }

  async run(
    req: VariantsRequest,
    emit: (e: VariantsEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const client = this.deps.makeClient();
    const key = variantsRequestKey(req, client.model);
    const hit = this.cache.get(key);
    if (hit) {
      emit({ type: 'start', model: client.model, cached: true });
      emit({ type: 'done', result: { ...hit, cached: true } });
      return;
    }
    if (this.running >= (this.deps.maxConcurrent ?? 3))
      throw new BusyError('Too many variant requests are running');
    this.running++;
    const timeout = AbortSignal.timeout(this.deps.timeoutMs ?? 5 * 60_000);
    try {
      const result = await runVariantsAgent({
        client,
        ctx: this.deps.ctx,
        request: req,
        emit,
        signal: AbortSignal.any([signal, timeout]),
      });
      if (result.ok) this.cache.set(key, result);
      emit({ type: 'done', result });
    } catch (e) {
      emit(toErrorEvent(e, timeout.aborted && !signal.aborted));
    } finally {
      this.running--;
    }
  }
}
