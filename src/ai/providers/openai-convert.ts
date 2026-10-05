import type Anthropic from '@anthropic-ai/sdk';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { ModelRequest } from '../agent/model-client';
import { blocksOf, makeMessage, resultText, textBlock, toolUseBlock } from './message';

/** Anthropic-сообщения → OpenAI chat completions (tool_result → role:"tool", tool_use → tool_calls). */
export function toOpenAIMessages(
  system: string,
  messages: Anthropic.MessageParam[],
): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    const blocks = blocksOf(m.content);
    if (m.role === 'user') {
      // результаты инструментов должны идти сразу после assistant с tool_calls
      for (const b of blocks) {
        if (b.type === 'tool_result')
          out.push({
            role: 'tool',
            tool_call_id: b.tool_use_id,
            content: (b.is_error ? 'ERROR: ' : '') + resultText(b.content),
          });
      }
      const text = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
      if (text) out.push({ role: 'user', content: text });
    } else {
      const text = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      const calls = blocks.flatMap((b) =>
        b.type === 'tool_use'
          ? [
              {
                id: b.id,
                type: 'function' as const,
                function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
              },
            ]
          : [],
      );
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length && { tool_calls: calls }),
      });
    }
  }
  return out;
}

export const toOpenAITools = (tools: ModelRequest['tools']): ChatCompletionTool[] =>
  tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));

/** Ответ OpenAI-совместимого API → Anthropic.Message. */
export function fromOpenAIResponse(res: ChatCompletion, model: string): Anthropic.Message {
  const choice = res.choices[0];
  const msg = choice?.message;
  const content: Anthropic.ContentBlock[] = [];
  if (msg?.content) content.push(textBlock(msg.content));
  for (const call of msg?.tool_calls ?? []) {
    if (call.type !== 'function') continue;
    let input: unknown;
    try {
      input = JSON.parse(call.function.arguments || '{}');
    } catch {
      // модель прислала битый JSON: агент вернёт ей ошибку схемы и она повторит вызов
      input = { __invalid_json: call.function.arguments };
    }
    content.push(toolUseBlock(call.id, call.function.name, input));
  }
  const finish = choice?.finish_reason;
  const stop: Anthropic.Message['stop_reason'] =
    msg?.refusal || finish === 'content_filter'
      ? 'refusal'
      : finish === 'length'
        ? 'max_tokens'
        : content.some((b) => b.type === 'tool_use')
          ? 'tool_use'
          : 'end_turn';
  return makeMessage(model, content, stop, {
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
    cachedInputTokens: res.usage?.prompt_tokens_details?.cached_tokens ?? 0,
  });
}
