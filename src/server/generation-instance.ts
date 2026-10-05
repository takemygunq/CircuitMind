import { createMockModelClient } from '@/ai/agent/mock-client';
import { boardStore } from './board-service';
import { GenerationService } from './generation';
import { RateLimiter } from './rate-limit';

import { isMockAi } from './mock-ai';
import { resolveDraftGenerator, resolveModel } from './providers/resolve';

export { isMockAi };

let service: GenerationService | undefined;
export function getGenerationService(): GenerationService {
  service ??= new GenerationService({
    makeClient: (req) => resolveModel({ mock: () => createMockModelClient(req.seed) }).client,
    ctx: {
      store: boardStore,
      // генерация недостающих плат доступна только с реальной моделью; выбор модели читается на каждый запрос
      get generateBoardDraft() {
        return resolveDraftGenerator();
      },
    },
  });
  return service;
}

/** Генерация стоит денег: 4 запроса за 10 минут с одного адреса. */
export const generationLimiter = new RateLimiter(4, 10 * 60_000);
