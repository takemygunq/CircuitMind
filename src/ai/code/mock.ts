import { buildPinBindings, templateBody } from '@/core/code';
import type { BoardDef, Language, Project } from '@/core/schema';
import { scriptedClient, textBlock, toolUse } from '../agent/scripted';
import type { CodeMode } from './events';

const BAD_PIN: Record<Language, string> = {
  arduino: 'void debugPin() { pinMode(27, OUTPUT); }',
  'esp-idf': 'void debug_pin(void) { gpio_set_level(GPIO_NUM_27, 1); }',
  micropython: 'debug = Pin(27, Pin.OUT)',
  circuitpython: 'debug = digitalio.DigitalInOut(board.IO27)',
  python: 'debug = Pin(27)',
};

/**
 * Клиент без сети (CIRCUITMIND_MOCK_AI=1): генерация/правка идут по сценарию «сначала ошибка линтера, потом исправление»,
 * объяснение — готовый текст. Тело кода берётся из детерминированного шаблона.
 */
export function createMockCodeClient(input: {
  project: Project;
  board: BoardDef;
  language: Language;
  mode: CodeMode;
  currentBody?: string;
  instruction?: string;
}) {
  const good = templateBody(
    input.project,
    input.board,
    buildPinBindings(input.project, input.board),
    input.language,
  );
  const edited =
    input.mode === 'edit' && input.currentBody
      ? `${input.currentBody.trimEnd()}\n${input.language === 'arduino' || input.language === 'esp-idf' ? '//' : '#'} [demo] ${input.instruction ?? ''}\n`
      : good;
  const explanation =
    input.mode === 'edit'
      ? `Демо-режим: к текущему коду добавлен комментарий с вашим запросом («${input.instruction ?? ''}»). Реальная модель внесла бы изменения в логику.`
      : 'Демо-шаблон: мигает светодиодом, читает кнопку и датчики и печатает значения в монитор. Реальная модель напишет логику под ваше описание.';
  if (input.mode === 'explain')
    return scriptedClient(
      [
        {
          content: [
            textBlock(
              'Это демо-объяснение. Программа настраивает пины из блока констант, затем в бесконечном цикле раз в секунду переключает светодиод, читает датчики и печатает значения в монитор порта.',
            ),
          ],
        },
      ],
      'mock-model',
    );
  return scriptedClient(
    [
      {
        content: [
          toolUse('submit_firmware', {
            body: `${edited}\n${BAD_PIN[input.language]}\n`,
            explanation,
            libraries: [],
          }),
        ],
      },
      {
        content: [
          toolUse('submit_firmware', {
            body: edited,
            explanation,
            libraries: input.project.codeHints?.libraries ?? [],
          }),
        ],
      },
    ],
    'mock-model',
  );
}
