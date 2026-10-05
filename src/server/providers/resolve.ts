import type { ModelClient } from '@/ai/agent/model-client';
import { defaultModel } from '@/ai/agent/model-client';
import type { DraftGenerator } from '@/ai/board-generator';
import { draftGeneratorFor } from '@/ai/providers/draft';
import { adapterFor } from '@/ai/providers/registry';
import type { ProviderKind, ProviderModel } from '@/ai/providers/types';
import { isMockAi } from '../mock-ai';
import { getActive, listProviders, providerConfig } from './store';

export interface Resolved extends ProviderModel {
  kind: ProviderKind | 'env' | 'mock';
  /** Для экрана настроек и логов: чем отвечает сервер. */
  label: string;
}

/** Активная модель: выбранная в настройках; без выбора — ключ Anthropic из окружения (как раньше). */
function activeSelection(): { providerId: string; modelId: string } | null {
  const active = getActive();
  const providers = listProviders();
  if (active) {
    const p = providers.find((x) => x.id === active.providerId && x.enabled);
    if (p) return active;
  }
  return null;
}

/** Настоящая модель из настроек или окружения; null — выбран провайдер «Demo». */
function resolveReal(maxTokens?: number): Resolved | null {
  const sel = activeSelection();
  if (sel) {
    const config = providerConfig(sel.providerId);
    if (config.kind === 'demo') return null;
    const model = adapterFor(config.kind).createModel(config, sel.modelId, { maxTokens });
    return { ...model, kind: config.kind, label: `${config.label} · ${sel.modelId}` };
  }
  const env = adapterFor('anthropic').createModel(
    { id: 'env', kind: 'anthropic', label: 'env', apiKey: '' },
    defaultModel(),
    { maxTokens },
  );
  return { ...env, kind: 'env', label: defaultModel() };
}

/**
 * Клиент модели для запроса. `mock` — сценарий без сети для демо-режима: его используют
 * CIRCUITMIND_MOCK_AI=1 и провайдер «Demo».
 */
export function resolveModel(opts: { mock: () => ModelClient; maxTokens?: number }): Resolved {
  const real = isMockAi() ? null : resolveReal(opts.maxTokens);
  if (real) return real;
  return {
    kind: 'mock',
    label: 'mock-model',
    client: opts.mock(),
    askJson: async () => {
      throw new Error('The demo mode cannot generate boards');
    },
  };
}

/** Генератор недостающих плат на активной модели. В демо-режиме недоступен. */
export function resolveDraftGenerator(): DraftGenerator | undefined {
  if (isMockAi()) return undefined;
  const real = resolveReal();
  return real ? draftGeneratorFor(real) : undefined;
}
