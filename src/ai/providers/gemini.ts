import { ApiError, GoogleGenAI } from '@google/genai';
import type { ModelClient } from '../agent/model-client';
import { fromGeminiResponse, toGeminiContents, toGeminiTools } from './gemini-convert';
import { ProviderError, type ModelEntry, type ProviderAdapter, type ProviderConfig } from './types';

const TIMEOUT_MS = 5 * 60_000;
const client = (c: ProviderConfig) =>
  new GoogleGenAI({
    apiKey: c.apiKey,
    httpOptions: { timeout: TIMEOUT_MS, ...(c.baseUrl ? { baseUrl: c.baseUrl } : {}) },
  });

export function mapGeminiError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof ApiError) {
    const s = e.status;
    if (s === 400 && /api key/i.test(e.message))
      return new ProviderError('Invalid Gemini API key', false, s);
    if (s === 401 || s === 403)
      return new ProviderError('Invalid Gemini API key or no access', false, s);
    if (s === 404) return new ProviderError('Model not found at Gemini', false, s);
    if (s === 429) return new ProviderError('Gemini rate limit reached', true, s);
    if (s >= 500) return new ProviderError(`Gemini error ${s}: ${e.message}`, true, s);
    return new ProviderError(`Gemini rejected the request: ${e.message}`, false, s);
  }
  const msg = e instanceof Error ? e.message : String(e);
  return new ProviderError(`No connection to Gemini: ${msg}`, e instanceof TypeError);
}

export const geminiAdapter: ProviderAdapter = {
  kind: 'gemini',
  title: 'Google Gemini API',
  createModel(config, modelId, opts) {
    const api = client(config);
    const label = `gemini:${modelId}`;
    const mc: ModelClient = {
      model: label,
      async turn({ system, tools, messages, signal }) {
        try {
          const res = await api.models.generateContent({
            model: modelId,
            contents: toGeminiContents(messages),
            config: {
              systemInstruction: system,
              maxOutputTokens: opts?.maxTokens ?? 16000,
              abortSignal: signal,
              ...(tools.length && { tools: [{ functionDeclarations: toGeminiTools(tools) }] }),
            },
          });
          return fromGeminiResponse(res, label);
        } catch (e) {
          throw mapGeminiError(e);
        }
      },
    };
    return {
      client: mc,
      async askJson({ system, prompt, schema, signal }) {
        try {
          const res = await api.models.generateContent({
            model: modelId,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
              systemInstruction: system,
              maxOutputTokens: 16000,
              abortSignal: signal,
              responseMimeType: 'application/json',
              responseJsonSchema: schema,
            },
          });
          if (res.promptFeedback?.blockReason)
            throw new ProviderError(
              `Gemini blocked the request: ${res.promptFeedback.blockReason}`,
              false,
            );
          if (res.candidates?.[0]?.finishReason === 'MAX_TOKENS')
            throw new ProviderError('The answer was cut off (max tokens)', false);
          if (!res.text) throw new ProviderError('Gemini returned an empty answer', true);
          return res.text;
        } catch (e) {
          throw mapGeminiError(e);
        }
      },
    };
  },
  async healthCheck(config) {
    try {
      await client(config).models.list({ config: { pageSize: 1 } });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: mapGeminiError(e).message };
    }
  },
  async listModels(config): Promise<ModelEntry[]> {
    try {
      const models: ModelEntry[] = [];
      for await (const m of await client(config).models.list()) {
        if (!m.name || !m.supportedActions?.includes('generateContent')) continue;
        models.push({ id: m.name.replace(/^models\//, ''), label: m.displayName });
      }
      return models;
    } catch (e) {
      throw mapGeminiError(e);
    }
  },
};
