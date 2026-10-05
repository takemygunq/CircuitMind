import { z } from 'zod';
import { BoardDraft } from '@/core/schema';
import type { DraftGenerator } from '../board-generator';
import { BOARD_SYSTEM_PROMPT, boardUserPrompt } from '../board-prompt';
import { extractJson } from './text-tools';
import { ProviderError, type ProviderModel } from './types';

/** Общий генератор черновиков плат для провайдеров без своих structured outputs: JSON Schema + разбор текста. */
export function genericDraftGenerator(model: ProviderModel): DraftGenerator {
  return async (input) => {
    // без $schema: Claude CLI не знает ссылку draft 2020-12 и отклоняет схему
    const { $schema: _draft, ...schema } = z.toJSONSchema(BoardDraft, { unrepresentable: 'any' });
    void _draft;
    const text = await model.askJson({
      system: BOARD_SYSTEM_PROMPT,
      prompt: boardUserPrompt(input),
      schema,
    });
    const json = extractJson(text);
    if (json === undefined)
      throw new ProviderError('The model did not return valid JSON for the board', false);
    // сырой JSON: ensureBoard сам проверит Zod и вернёт ошибки модели
    return json;
  };
}

export const draftGeneratorFor = (model: ProviderModel): DraftGenerator =>
  model.draftGenerator ?? genericDraftGenerator(model);
