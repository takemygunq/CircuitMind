import type { Project } from '@/core/schema';
import { weatherEsp32 } from '@/core/fixtures';
import { scriptedClient, textBlock, toolUse } from './scripted';

/**
 * Клиент без сети для разработки и демонстрации (CIRCUITMIND_MOCK_AI=1).
 * Сценарий: поиск и расчёт → проект с намеренной ошибкой (светодиод без резистора) → ERC возвращает ошибки → исправленный проект.
 * Всегда собирает метеостанцию на ESP32 — содержимое запроса он не анализирует.
 */
export function createMockModelClient(seed?: Project) {
  if (seed) return createSeededMockClient(seed);
  const good = JSON.parse(JSON.stringify(weatherEsp32)) as typeof weatherEsp32;
  const broken = JSON.parse(JSON.stringify(weatherEsp32)) as typeof weatherEsp32;
  broken.parts = broken.parts.filter((p) => p.instanceId !== 'R1');
  broken.connections = broken.connections.filter(
    (c) => !c.from.startsWith('R1:') && !c.to.startsWith('R1:') && !(c.from === 'board:GPIO18'),
  );
  broken.connections.push({
    from: 'board:GPIO18',
    to: 'led1:anode',
    netName: 'LED_A',
    color: 'orange',
  });
  broken.bom = broken.bom.filter((b) => b.value !== '220');

  return scriptedClient(
    [
      {
        content: [
          textBlock('Подбираю плату и компоненты.'),
          toolUse('list_boards', {}),
          toolUse('search_components', { query: 'temperature humidity', category: null }),
          toolUse('search_components', { query: 'oled', category: null }),
        ],
      },
      {
        content: [
          toolUse('get_board', { boardId: 'esp32-devkit-v1' }),
          toolUse('calculate', { type: 'led_resistor', inputs: { vccV: 3.3, vfV: 2, ifMa: 6 } }),
        ],
      },
      { content: [toolUse('create_project', broken)] },
      { content: [toolUse('create_project', good)] },
      { content: [textBlock('Готово.')] },
    ],
    'mock-model',
  );
}

/** Режим 2 → Режим 1: черновик варианта доводится до проекта без изменений (в проде это делает модель). */
function createSeededMockClient(seed: Project) {
  return scriptedClient(
    [
      {
        content: [
          textBlock('Дорабатываю выбранный вариант.'),
          toolUse('get_board', { boardId: seed.boardId }),
        ],
      },
      { content: [toolUse('create_project', JSON.parse(JSON.stringify(seed)))] },
      { content: [textBlock('Готово.')] },
    ],
    'mock-model',
  );
}
