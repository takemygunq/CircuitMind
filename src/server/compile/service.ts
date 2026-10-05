import { createHash } from 'node:crypto';
import { ResultCache } from '../generation';
import type { CompileRequest, CompileResult, CompileRunner } from './types';

export class CompileBusyError extends Error {}
export class CompilerUnavailableError extends Error {}

export interface CompileServiceDeps {
  runner: CompileRunner;
  timeoutMs?: number;
  maxConcurrent?: number;
  cache?: ResultCache<CompileResult>;
}

/** Очередь компиляций: ограничение параллелизма, кэш по хэшу (компиляция детерминирована), проверка доступности. */
export class CompileService {
  private running = 0;
  private readonly cache: ResultCache<CompileResult>;
  constructor(private readonly deps: CompileServiceDeps) {
    this.cache = deps.cache ?? new ResultCache<CompileResult>(60 * 60_000, 30);
  }

  available(): Promise<boolean> {
    return this.deps.runner.available();
  }

  async compile(req: CompileRequest): Promise<CompileResult> {
    const key = createHash('sha256')
      .update(JSON.stringify([req.fqbn, req.code]))
      .digest('hex');
    const hit = this.cache.get(key);
    if (hit) return { ...hit, cached: true };
    if (!(await this.available()))
      throw new CompilerUnavailableError('Compiler image is not available');
    if (this.running >= (this.deps.maxConcurrent ?? 2))
      throw new CompileBusyError('Too many compilations are running');
    this.running++;
    try {
      const result = await this.deps.runner.run(req, this.deps.timeoutMs ?? 120_000);
      if (!result.timedOut && (result.ok || result.diagnostics.length > 0))
        this.cache.set(key, result);
      return result;
    } finally {
      this.running--;
    }
  }
}
