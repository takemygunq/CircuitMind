import type Anthropic from '@anthropic-ai/sdk';
import type { Content, FunctionDeclaration, GenerateContentResponse, Part } from '@google/genai';
import type { ModelRequest } from '../agent/model-client';
import { blocksOf, makeMessage, newToolId, resultText, textBlock, toolUseBlock } from './message';

/** Подпись размышлений Gemini 3 хранится на tool_use-блоке и возвращается при следующем ходе. */
type WithSignature = { thoughtSignature?: string };

export function toGeminiContents(messages: Anthropic.MessageParam[]): Content[] {
  // Gemini ждёт имя функции в functionResponse, а Anthropic-формат даёт только id вызова
  const names = new Map<string, string>();
  const out: Content[] = [];
  for (const m of messages) {
    const blocks = blocksOf(m.content);
    if (m.role === 'assistant') {
      const parts: Part[] = [];
      for (const b of blocks) {
        if (b.type === 'text' && b.text) parts.push({ text: b.text });
        else if (b.type === 'tool_use') {
          names.set(b.id, b.name);
          const sig = (b as WithSignature).thoughtSignature;
          parts.push({
            functionCall: { name: b.name, args: (b.input ?? {}) as Record<string, unknown> },
            ...(sig && { thoughtSignature: sig }),
          });
        }
      }
      if (parts.length) out.push({ role: 'model', parts });
    } else {
      const parts: Part[] = [];
      for (const b of blocks) {
        if (b.type === 'tool_result')
          parts.push({
            functionResponse: {
              name: names.get(b.tool_use_id) ?? 'tool',
              response: b.is_error
                ? { error: resultText(b.content) }
                : { output: resultText(b.content) },
            },
          });
      }
      for (const b of blocks) if (b.type === 'text' && b.text) parts.push({ text: b.text });
      if (parts.length) out.push({ role: 'user', parts });
    }
  }
  return out;
}

export const toGeminiTools = (tools: ModelRequest['tools']): FunctionDeclaration[] =>
  tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.input_schema,
  }));

export function fromGeminiResponse(res: GenerateContentResponse, model: string): Anthropic.Message {
  const candidate = res.candidates?.[0];
  const content: Anthropic.ContentBlock[] = [];
  let text = '';
  for (const p of candidate?.content?.parts ?? []) {
    if (p.thought) continue;
    if (p.text) text += p.text;
    if (p.functionCall?.name) {
      if (text) {
        content.push(textBlock(text));
        text = '';
      }
      content.push(
        toolUseBlock(
          p.functionCall.id ?? newToolId('gem'),
          p.functionCall.name,
          p.functionCall.args ?? {},
          p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {},
        ),
      );
    }
  }
  if (text) content.push(textBlock(text));
  const finish = candidate?.finishReason;
  const blocked =
    !!res.promptFeedback?.blockReason || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT';
  const stop: Anthropic.Message['stop_reason'] = blocked
    ? 'refusal'
    : finish === 'MAX_TOKENS'
      ? 'max_tokens'
      : content.some((b) => b.type === 'tool_use')
        ? 'tool_use'
        : 'end_turn';
  const u = res.usageMetadata;
  return makeMessage(model, content, stop, {
    inputTokens: u?.promptTokenCount ?? 0,
    outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
    cachedInputTokens: u?.cachedContentTokenCount ?? 0,
  });
}
