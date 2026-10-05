import OpenAI, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai';
import type { ModelClient } from '../agent/model-client';
import { fromOpenAIResponse, toOpenAIMessages, toOpenAITools } from './openai-convert';
import {
  ProviderError,
  type ModelEntry,
  type ProviderAdapter,
  type ProviderConfig,
  type ProviderKind,
} from './types';

const TIMEOUT_MS = 5 * 60_000;
/** Модели, которые не умеют в чат (эмбеддинги, речь, картинки) — скрываем из списка. */
const NON_CHAT =
  /embedding|tts|whisper|dall-e|gpt-image|moderation|transcribe|realtime|audio|davinci|babbage|search/i;

export function mapOpenAIError(e: unknown, name: string, hint = ''): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof AuthenticationError)
    return new ProviderError(`Invalid ${name} API key`, false, 401);
  if (e instanceof PermissionDeniedError)
    return new ProviderError(`No access to the model or resource at ${name}`, false, 403);
  if (e instanceof NotFoundError)
    return new ProviderError(`Model not found at ${name}`, false, 404);
  if (e instanceof BadRequestError)
    return new ProviderError(`${name} rejected the request: ${e.message}`, false, 400);
  if (e instanceof RateLimitError)
    return new ProviderError(`${name} rate limit reached (or out of credit)`, true, 429);
  if (e instanceof APIConnectionError)
    return new ProviderError(
      `No connection to ${name}: ${e.message.replace(/\.$/, '')}${hint ? `. ${hint}` : ''}`,
      true,
    );
  if (e instanceof APIError)
    return new ProviderError(
      `${name} error ${e.status ?? ''}: ${e.message}`,
      (e.status ?? 500) >= 500,
      e.status,
    );
  return new ProviderError(e instanceof Error ? e.message : String(e), false);
}

interface Options {
  kind: ProviderKind;
  title: string;
  name: string;
  defaultBaseUrl?: string | (() => string);
  headers?: Record<string, string>;
  /** Ключ не нужен (Ollama): SDK всё равно требует непустую строку. */
  keyless?: boolean;
  healthCheck?: (config: ProviderConfig, baseUrl: string) => Promise<void>;
  hint?: string;
  filterModel?: (id: string) => boolean;
}

/** Адаптер OpenAI-совместимого API: OpenAI, OpenRouter, Ollama. */
export function createOpenAICompatibleAdapter(o: Options): ProviderAdapter {
  const baseUrl = (c: ProviderConfig) =>
    c.baseUrl || (typeof o.defaultBaseUrl === 'function' ? o.defaultBaseUrl() : o.defaultBaseUrl);
  const api = (c: ProviderConfig) =>
    new OpenAI({
      apiKey: c.apiKey || (o.keyless ? 'local' : ''),
      baseURL: baseUrl(c),
      timeout: TIMEOUT_MS,
      maxRetries: 2,
      defaultHeaders: o.headers,
    });
  const mapError = (e: unknown) => mapOpenAIError(e, o.name, o.hint);

  return {
    kind: o.kind,
    title: o.title,
    createModel(config, modelId, opts) {
      const sdk = api(config);
      const maxTokens = opts?.maxTokens ?? 16000;
      const client: ModelClient = {
        model: `${o.kind}:${modelId}`,
        async turn({ system, tools, messages, signal, onText }) {
          try {
            const res = await sdk.chat.completions.create(
              {
                model: modelId,
                messages: toOpenAIMessages(system, messages),
                ...(tools.length && { tools: toOpenAITools(tools) }),
                max_completion_tokens: maxTokens,
              },
              { signal },
            );
            const msg = fromOpenAIResponse(res, `${o.kind}:${modelId}`);
            const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
            if (text) onText?.(text);
            if (!res.choices[0])
              throw new ProviderError(`${o.name} returned an empty answer`, true);
            return msg;
          } catch (e) {
            throw mapError(e);
          }
        },
      };
      return {
        client,
        async askJson({ system, prompt, schema, signal }) {
          try {
            const res = await sdk.chat.completions.create(
              {
                model: modelId,
                messages: [
                  { role: 'system', content: system },
                  { role: 'user', content: prompt },
                ],
                max_completion_tokens: 16000,
                response_format: {
                  type: 'json_schema',
                  // strict: false — в схемах есть необязательные поля, а strict требует все поля обязательными
                  json_schema: {
                    name: 'response',
                    schema: schema as Record<string, unknown>,
                    strict: false,
                  },
                },
              },
              { signal },
            );
            const choice = res.choices[0];
            if (!choice) throw new ProviderError(`${o.name} returned an empty answer`, true);
            if (choice.message.refusal)
              throw new ProviderError(`The model declined: ${choice.message.refusal}`, false);
            if (choice.finish_reason === 'length')
              throw new ProviderError('The answer was cut off (max tokens)', false);
            return choice.message.content ?? '';
          } catch (e) {
            throw mapError(e);
          }
        },
      };
    },
    async healthCheck(config) {
      try {
        if (o.healthCheck) await o.healthCheck(config, baseUrl(config) ?? '');
        else await api(config).models.list();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: mapError(e).message };
      }
    },
    async listModels(config): Promise<ModelEntry[]> {
      try {
        const models: ModelEntry[] = [];
        for await (const m of api(config).models.list()) {
          if (o.filterModel && !o.filterModel(m.id)) continue;
          const name = (m as { name?: string }).name;
          models.push(name && name !== m.id ? { id: m.id, label: name } : { id: m.id });
        }
        return models.sort((a, b) => a.id.localeCompare(b.id));
      } catch (e) {
        throw mapError(e);
      }
    },
  };
}

export const openaiAdapter = createOpenAICompatibleAdapter({
  kind: 'openai',
  title: 'OpenAI API',
  name: 'OpenAI',
  filterModel: (id) => !NON_CHAT.test(id),
});

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const openrouterAdapter = createOpenAICompatibleAdapter({
  kind: 'openrouter',
  title: 'OpenRouter',
  name: 'OpenRouter',
  defaultBaseUrl: () => process.env.OPENROUTER_BASE_URL ?? OPENROUTER_BASE_URL,
  headers: { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'CircuitMind' },
  // список моделей у OpenRouter открытый — ключ проверяем отдельным запросом
  async healthCheck(config, base) {
    const res = await fetch(`${base}/key`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (res.status === 401 || res.status === 403)
      throw new ProviderError('Invalid OpenRouter API key', false, res.status);
    if (!res.ok)
      throw new ProviderError(`OpenRouter answered ${res.status}`, res.status >= 500, res.status);
  },
});

export const OLLAMA_BASE_URL = 'http://localhost:11434/v1';
export const ollamaAdapter = createOpenAICompatibleAdapter({
  kind: 'ollama',
  title: 'Ollama (local models)',
  name: 'Ollama',
  defaultBaseUrl: OLLAMA_BASE_URL,
  keyless: true,
  hint: 'Is Ollama running? Run in a terminal: ollama serve',
});
