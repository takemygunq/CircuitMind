import type Anthropic from '@anthropic-ai/sdk';
import type { ModelClient, ModelRequest } from './model-client';

type Block = Anthropic.ContentBlock;
export type Turn = {
  content: Block[];
  stopReason?: Anthropic.Message['stop_reason'];
  usage?: { input?: number; output?: number; cacheRead?: number };
};
/** Ход может зависеть от истории (для имитации исправлений). */
export type TurnScript = Turn | ((req: ModelRequest, turnIndex: number) => Turn);

let counter = 0;
export const toolUse = (name: string, input: unknown): Anthropic.ToolUseBlock =>
  ({
    type: 'tool_use',
    id: `toolu_${++counter}`,
    name,
    input,
    caller: { type: 'direct' },
  }) as Anthropic.ToolUseBlock;
export const textBlock = (text: string): Anthropic.TextBlock =>
  ({ type: 'text', text, citations: null }) as Anthropic.TextBlock;

function asMessage(turn: Turn, model: string): Anthropic.Message {
  const stop =
    turn.stopReason ?? (turn.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn');
  return {
    id: `msg_${++counter}`,
    type: 'message',
    role: 'assistant',
    model,
    content: turn.content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: turn.usage?.input ?? 1000,
      output_tokens: turn.usage?.output ?? 300,
      cache_read_input_tokens: turn.usage?.cacheRead ?? 0,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

/** Модель, проигрывающая заранее заданные ходы. Используется в тестах и в режиме CIRCUITMIND_MOCK_AI=1. */
export function scriptedClient(
  script: TurnScript[],
  model = 'scripted-model',
): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    model,
    requests,
    async turn(req) {
      const i = requests.length;
      requests.push({ ...req, messages: structuredClone(req.messages) });
      const step = script[Math.min(i, script.length - 1)];
      const turn = typeof step === 'function' ? step(req, i) : step;
      const textDelta = turn.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      if (textDelta) req.onText?.(textDelta.text);
      return asMessage(turn, model);
    },
  };
}
