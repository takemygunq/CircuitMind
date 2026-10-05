import { z } from 'zod';
import { BoardDef, ComponentDef, Project, BOARD_REF, parseEndpoint } from '../schema';

import arduinoUno from '../../../library/boards/arduino-uno.json';
import esp32 from '../../../library/boards/esp32-devkit-v1.json';
import pico from '../../../library/boards/raspberry-pi-pico.json';

import button from '../../../library/components/button-6mm.json';
import dcMotor from '../../../library/components/dc-motor-130.json';
import relayCoil from '../../../library/components/relay-5v-coil.json';
import relayModule from '../../../library/components/relay-module-1ch.json';
import levelShifter from '../../../library/components/level-shifter-4ch.json';
import dht22 from '../../../library/components/dht22.json';
import diode from '../../../library/components/diode-1n4007.json';
import hcsr04 from '../../../library/components/hc-sr04.json';
import led from '../../../library/components/led-5mm-red.json';
import mosfet from '../../../library/components/mosfet-irlz44n.json';
import npn from '../../../library/components/npn-2n2222.json';
import pot from '../../../library/components/potentiometer-10k.json';
import resistor from '../../../library/components/resistor.json';
import servo from '../../../library/components/servo-sg90.json';
import ssd1306 from '../../../library/components/ssd1306-128x64-i2c.json';

// Чтобы добавить плату или компонент: положить JSON в library/ и добавить импорт сюда.
export const boards: BoardDef[] = z.array(BoardDef).parse([arduinoUno, esp32, pico]);

export const components: ComponentDef[] = z
  .array(ComponentDef)
  .parse([
    dcMotor,
    relayCoil,
    relayModule,
    levelShifter,
    button,
    dht22,
    diode,
    hcsr04,
    led,
    mosfet,
    npn,
    pot,
    resistor,
    servo,
    ssd1306,
  ]);

const boardById = new Map(boards.map((b) => [b.id, b]));
const componentById = new Map(components.map((c) => [c.id, c]));

export const getBoard = (id: string): BoardDef | undefined => boardById.get(id);
export const getComponent = (id: string): ComponentDef | undefined => componentById.get(id);

export function searchComponents(query: string, category?: string): ComponentDef[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return components.filter((c) => {
    if (category && c.category !== category) return false;
    const hay =
      `${c.id} ${c.name} ${c.category} ${c.kind ?? ''} ${c.tags.join(' ')} ${c.description ?? ''}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export interface RefIssue {
  path: string;
  message: string;
}

/** Сверка проекта с библиотекой: существуют ли плата, компоненты и пины. Это не ERC. */
export function validateProjectRefs(project: Project): RefIssue[] {
  const issues: RefIssue[] = [];
  const board = getBoard(project.boardId);
  if (!board) issues.push({ path: 'boardId', message: `unknown board "${project.boardId}"` });

  const partComponent = new Map<string, ComponentDef | undefined>();
  project.parts.forEach((part, i) => {
    const def = getComponent(part.componentId);
    if (!def)
      issues.push({
        path: `parts[${i}].componentId`,
        message: `unknown component "${part.componentId}"`,
      });
    partComponent.set(part.instanceId, def);
  });

  project.connections.forEach((conn, i) => {
    for (const side of ['from', 'to'] as const) {
      const { ref, pin } = parseEndpoint(conn[side]);
      const pins = ref === BOARD_REF ? board?.pins : partComponent.get(ref)?.pins;
      if (pins && !pins.some((p) => p.id === pin))
        issues.push({ path: `connections[${i}].${side}`, message: `"${ref}" has no pin "${pin}"` });
    }
  });

  project.bom.forEach((item, i) => {
    if (!getComponent(item.componentId))
      issues.push({
        path: `bom[${i}].componentId`,
        message: `unknown component "${item.componentId}"`,
      });
  });
  return issues;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Точный поиск платы по id, названию или алиасу (без учёта регистра и знаков). */
export function findBoardIn(list: readonly BoardDef[], query: string): BoardDef | undefined {
  const q = norm(query);
  if (!q) return undefined;
  return list.find((b) => [b.id, b.name, ...b.aliases].some((name) => norm(name) === q));
}
