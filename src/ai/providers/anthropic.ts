import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicDraftGenerator } from '../anthropic-board-generator';
import { createAnthropicModelClient, defaultModel } from '../agent/model-client';
import { ProviderError, type ModelEntry, type ProviderAdapter, type ProviderConfig } from './types';

const client = (c: ProviderConfig) =>
  new Anthropic({
    ...(c.apiKey && { apiKey: c.apiKey }),
    ...(c.baseUrl && { baseURL: c.baseUrl }),
    maxRetries: 2,
  });

export function mapAnthropicError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.AuthenticationError)
    return new ProviderError('Invalid Anthropic API key', false, 401);
  if (e instanceof Anthropic.PermissionDeniedError)
    return new ProviderError('No access to this model or resource', false, 403);
  if (e instanceof Anthropic.NotFoundError)
    return new ProviderError('Model not found at Anthropic', false, 404);
  if (e instanceof Anthropic.RateLimitError)
    return new ProviderError('Anthropic rate limit reached (or out of credit)', true, 429);
  if (e instanceof Anthropic.APIConnectionError)
    return new ProviderError(`No connection to Anthropic: ${e.message}`, true);
  if (e instanceof Anthropic.APIError)
    return new ProviderError(
      `Anthropic error ${e.status ?? ''}: ${e.message}`,
      (e.status ?? 500) >= 500,
      e.status,
    );
  return new ProviderError(e instanceof Error ? e.message : String(e), false);
}

export const anthropicAdapter: ProviderAdapter = {
  kind: 'anthropic',
  title: 'Anthropic API',
  createModel(config, modelId, opts) {
    const api = client(config);
    return {
      client: createAnthropicModelClient({
        client: api,
        model: modelId,
        maxTokens: opts?.maxTokens,
      }),
      draftGenerator: createAnthropicDraftGenerator({ client: api, model: modelId }),
      async askJson({ system, prompt, schema, signal }) {
        try {
          const res = await api.messages.create(
            {
              model: modelId,
              max_tokens: 16000,
              system,
              messages: [{ role: 'user', content: prompt }],
              output_config: {
                format: { type: 'json_schema', schema: schema as Record<string, unknown> },
              },
            },
            { signal },
          );
          if (res.stop_reason === 'refusal')
            throw new ProviderError('The model declined the request', false);
          if (res.stop_reason === 'max_tokens')
            throw new ProviderError('The answer was cut off (max_tokens)', false);
          return res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        } catch (e) {
          throw mapAnthropicError(e);
        }
      },
    };
  },
  async healthCheck(config) {
    try {
      await client(config).models.list({ limit: 1 });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: mapAnthropicError(e).message };
    }
  },
  async listModels(config): Promise<ModelEntry[]> {
    try {
      const out: ModelEntry[] = [];
      for await (const m of client(config).models.list({ limit: 100 }))
        out.push({ id: m.id, label: m.display_name });
      return out.length ? out : [{ id: defaultModel() }];
    } catch (e) {
      throw mapAnthropicError(e);
    }
  },
};
