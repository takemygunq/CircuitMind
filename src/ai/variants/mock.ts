import { mockVariantInputs } from '@/core/fixtures';
import { scriptedClient, textBlock, toolUse } from '../agent/scripted';

/** Клиент без сети (CIRCUITMIND_MOCK_AI=1): поиск → набор из четырёх готовых вариантов. Инвентарь пользователя он не анализирует — это делает проверка состава. */
export function createMockVariantsClient() {
  const variants = JSON.parse(JSON.stringify(mockVariantInputs));
  return scriptedClient(
    [
      {
        content: [
          textBlock('Смотрю, что можно собрать из ваших запасов.'),
          toolUse('list_boards', {}),
          toolUse('search_components', { query: 'led potentiometer', category: null }),
        ],
      },
      { content: [toolUse('suggest_variants', { variants })] },
      { content: [toolUse('suggest_variants', { variants })] },
      { content: [textBlock('Готово.')] },
    ],
    'mock-model',
  );
}
