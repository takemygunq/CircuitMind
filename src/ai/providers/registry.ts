import { anthropicAdapter } from './anthropic';
import { claudeCliAdapter, codexCliAdapter, geminiCliAdapter } from './cli';
import { geminiAdapter } from './gemini';
import { ollamaAdapter, openaiAdapter, openrouterAdapter } from './openai';
import type { ProviderAdapter, ProviderKind } from './types';

/** Демо-провайдер не ходит в сеть: его «модель» подставляет сервер (сценарии mock-клиентов). */
const demoAdapter: ProviderAdapter = {
  kind: 'demo',
  title: 'Demo (no model)',
  createModel() {
    throw new Error('The demo provider has no model client');
  },
  async healthCheck() {
    return { ok: true };
  },
  async listModels() {
    return [{ id: 'demo', label: 'Scripted demo' }];
  },
};

export const ADAPTERS: Record<ProviderKind, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
  openrouter: openrouterAdapter,
  ollama: ollamaAdapter,
  'claude-cli': claudeCliAdapter,
  'codex-cli': codexCliAdapter,
  'gemini-cli': geminiCliAdapter,
  demo: demoAdapter,
};

export function adapterFor(kind: string): ProviderAdapter {
  const a = (ADAPTERS as Record<string, ProviderAdapter | undefined>)[kind];
  if (!a) throw new Error(`Unknown provider kind: ${kind}`);
  return a;
}
