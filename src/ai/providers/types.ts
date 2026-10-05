import type { ModelClient } from '../agent/model-client';
import type { DraftGenerator } from '../board-generator';

export const PROVIDER_KINDS = [
  'anthropic',
  'openai',
  'gemini',
  'openrouter',
  'ollama',
  'claude-cli',
  'codex-cli',
  'gemini-cli',
  'demo',
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Расшифрованная конфигурация провайдера (только на сервере). */
export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  apiKey: string;
  /** Адрес API (прокси, Ollama) или путь к программе для CLI-мостов. */
  baseUrl?: string;
}

export interface ModelEntry {
  id: string;
  label?: string;
}

export interface JsonRequest {
  system: string;
  prompt: string;
  /** JSON Schema ожидаемого ответа. */
  schema: object;
  signal?: AbortSignal;
}

/** Модель провайдера: ход с инструментами (агенты) и разовый структурированный ответ (генерация плат). */
export interface ProviderModel {
  client: ModelClient;
  /** Возвращает текст JSON; проверку (Zod) делает вызывающий код. */
  askJson(req: JsonRequest): Promise<string>;
  /** Нативный генератор плат (structured outputs); без него используется общий через askJson. */
  draftGenerator?: DraftGenerator;
}

export interface ProviderAdapter {
  kind: ProviderKind;
  title: string;
  createModel(
    config: ProviderConfig,
    modelId: string,
    opts?: { maxTokens?: number },
  ): ProviderModel;
  healthCheck(config: ProviderConfig): Promise<{ ok: boolean; error?: string }>;
  listModels(config: ProviderConfig): Promise<ModelEntry[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Провайдеры без API-ключа. */
export const KEYLESS_KINDS: readonly ProviderKind[] = [
  'demo',
  'ollama',
  'claude-cli',
  'codex-cli',
  'gemini-cli',
];
/** CLI-мосты к подпискам: поле «адрес» — путь к программе. */
export const CLI_KINDS: readonly ProviderKind[] = ['claude-cli', 'codex-cli', 'gemini-cli'];
