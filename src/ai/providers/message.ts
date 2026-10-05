import type Anthropic from '@anthropic-ai/sdk';

let counter = 0;
export const newToolId = (prefix = 'call') => `${prefix}_${Date.now().toString(36)}${++counter}`;

export interface UsageLike {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/** Собирает Anthropic.Message из ответа стороннего провайдера — остальной код видит единый формат. */
export function makeMessage(
  model: string,
  content: Anthropic.ContentBlock[],
  stop: Anthropic.Message['stop_reason'],
  usage: UsageLike,
): Anthropic.Message {
  return {
    id: newToolId('msg'),
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_input_tokens: usage.cachedInputTokens ?? 0,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

export const textBlock = (text: string) =>
  ({ type: 'text', text, citations: null }) as Anthropic.TextBlock;

export const toolUseBlock = (id: string, name: string, input: unknown, extra: object = {}) =>
  ({
    type: 'tool_use',
    id,
    name,
    input,
    caller: { type: 'direct' },
    ...extra,
  }) as Anthropic.ToolUseBlock;

/** Текст из content tool_result (строка или блоки). */
export function resultText(content: Anthropic.ToolResultBlockParam['content']): string {
  if (typeof content === 'string') return content;
  return (content ?? []).map((b) => (b.type === 'text' ? b.text : '')).join('');
}

/** Нормализует content сообщения в массив блоков. */
export function blocksOf(
  content: string | Anthropic.ContentBlockParam[],
): Anthropic.ContentBlockParam[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}
