import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { BoardDraft } from '@/core/schema';
import { BOARD_SYSTEM_PROMPT, boardUserPrompt } from './board-prompt';
import type { DraftGenerator } from './board-generator';

export function defaultModel(): string {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
}

/** Генератор черновиков на Claude через structured outputs. Ключ — только на сервере (ANTHROPIC_API_KEY). */
export function createAnthropicDraftGenerator(
  opts: { client?: Anthropic; model?: string } = {},
): DraftGenerator {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? defaultModel();
  return async (input) => {
    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      system: BOARD_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: boardUserPrompt(input) }],
      output_config: { format: zodOutputFormat(BoardDraft) },
    });
    if (response.stop_reason === 'refusal')
      throw new Error('The model declined to describe this board');
    if (response.stop_reason === 'max_tokens')
      throw new Error('The board description was cut off (max_tokens)');
    // null → вернём как есть: ensureBoard превратит это в понятную ошибку валидации и повторит попытку
    return response.parsed_output;
  };
}
