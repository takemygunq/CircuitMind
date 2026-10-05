import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { CALC_TYPES, CalcError, calculate } from '@/core/calc';
import { runErc, violationsForAi, type ErcReport } from '@/core/erc';
import {
  boards as builtinBoards,
  components,
  findBoardIn,
  getComponent,
  searchComponents,
  validateProjectRefs,
} from '@/core/library';
import type { BoardStore } from '@/core/library/store';
import { Project, type BoardDef, type ComponentDef, type PinDef } from '@/core/schema';
import { BoardGenerationError, ensureBoard, type DraftGenerator } from '../board-generator';

/** Всё, что нужно инструментам агента. generateBoardDraft нет → ensure_board недоступен. */
export interface ToolContext {
  store: BoardStore;
  generateBoardDraft?: DraftGenerator;
}

export interface ToolOutcome {
  ok: boolean;
  /** Текст tool_result для модели (JSON). */
  content: string;
  /** Короткое описание для ленты статуса в UI. */
  summary: string;
}

export const TOOL_NAMES = [
  'list_boards',
  'get_board',
  'ensure_board',
  'search_components',
  'calculate',
  'create_project',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

// ───────── определения инструментов ─────────

const projectJsonSchema = (): Anthropic.Tool['input_schema'] => {
  const { $schema, ...schema } = z.toJSONSchema(Project, {
    io: 'input',
    target: 'draft-7',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  void $schema;
  return schema as Anthropic.Tool['input_schema'];
};

export function toolDefinitions(opts: { canGenerateBoards: boolean }): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [
    {
      name: 'list_boards',
      description:
        'List the boards available in the local library (id, name, MCU, logic voltage, aliases). Call it first when the user did not name a board.',
      input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      strict: true,
    },
    {
      name: 'get_board',
      description:
        'Get the full pinout of a board by id: every pin with its functions, voltage, current limit, restriction flags and notes, plus power rails and supply range. Always call it before wiring.',
      input_schema: {
        type: 'object',
        properties: {
          boardId: {
            type: 'string',
            description: 'Board id from list_boards, e.g. "esp32-devkit-v1"',
          },
        },
        required: ['boardId'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'search_components',
      description:
        'Search the local component library by words (name, kind, description). Returns matching components with their pins, electrical parameters and notes. Components are referenced by id in the project. Use an empty query with a category to list a whole category.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search words, e.g. "temperature humidity" or "oled"',
          },
          category: {
            type: ['string', 'null'],
            enum: [
              'passive',
              'led',
              'switch',
              'transistor',
              'diode',
              'sensor',
              'display',
              'actuator',
              'driver',
              'power',
              'module',
              'generic',
              null,
            ],
            description: 'Optional category filter',
          },
        },
        required: ['query', 'category'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'calculate',
      description:
        'Deterministic calculators. NEVER compute resistor values or budgets yourself — call this. ' +
        'Types and inputs: led_resistor {vccV, vfV, ifMa}; bjt_base_resistor {vdriveV, icMa, hfeMin?, forcedBeta?}; voltage_divider {vinV, r1Ohm, r2Ohm}; ' +
        'divider_design {vinV, voutV, r2Ohm?}; i2c_pullup {vccV, busCapPf, speedKhz: 100|400|1000}; pull_resistor {vccV, maxCurrentMa?}; ' +
        'mosfet_logic_level {vgsDriveV, vgsThMaxV, rdsOnOhm?, rdsOnAtVgsV?, loadCurrentA?}; current_budget {sourceMa, "load:<name>": mA, ...}; ' +
        'battery_life {capacityMah, activeMa, sleepMa?, duty?}; level_check {driverV, receiverMaxV, receiverVihMinV}. Optional "series": 12 or 24 for E-series. ' +
        'Put the result into project.calculations with the same inputs, formula, result and unit.',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...CALC_TYPES] },
          inputs: { type: 'object', additionalProperties: { type: 'number' } },
        },
        required: ['type', 'inputs'],
      },
    },
    {
      name: 'create_project',
      description:
        'Submit the final project. It is validated (schema, library references) and checked by the Electrical Rules Check. ' +
        'If problems are returned, fix ALL of them and call create_project again with the complete corrected project. ' +
        'Call it only when the design is complete. Do not write any prose after a successful result.',
      input_schema: projectJsonSchema(),
    },
  ];
  if (opts.canGenerateBoards) {
    tools.splice(2, 0, {
      name: 'ensure_board',
      description:
        'Use ONLY if the user needs a board that list_boards does not contain. Describes the missing board, validates it and adds it to the library (marked as unverified). Returns the board summary; then call get_board with its id.',
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Board name as the user calls it, e.g. "Arduino Nano"',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
      strict: true,
    });
  }
  // крупные входы (create_project) стримятся по мере генерации; валидацию делаем сами через Zod
  return tools.map((t) => ({ ...t, eager_input_streaming: true }));
}

// ───────── выполнение ─────────

const json = (v: unknown) => JSON.stringify(v);
const fail = (
  error: string,
  extra: Record<string, unknown> = {},
  summary = error,
): ToolOutcome => ({ ok: false, content: json({ error, ...extra }), summary });

const compactPin = (p: PinDef) => ({
  id: p.id,
  label: p.label,
  functions: p.functions,
  ...(p.electrical && { electrical: p.electrical }),
  ...(p.voltage !== undefined && { voltage: p.voltage }),
  ...(p.maxCurrentMa !== undefined && { maxCurrentMa: p.maxCurrentMa }),
  ...(p.maxInputV !== undefined && { maxInputV: p.maxInputV }),
  ...(p.minHighV !== undefined && { minHighV: p.minHighV }),
  ...(p.referenceSupply && { referenceSupply: p.referenceSupply }),
  ...(p.analog && { analog: true }),
  ...(p.flags.length && { flags: p.flags }),
  ...(p.notes.length && { notes: p.notes }),
});

const boardSummary = (b: BoardDef) => ({
  id: b.id,
  name: b.name,
  mcu: b.mcu,
  logicVoltage: b.logicVoltage,
  aliases: b.aliases,
  languages: b.languages,
  simulator: b.simulator,
  verified: b.verified,
});

const componentView = (c: ComponentDef) => ({
  id: c.id,
  name: c.name,
  category: c.category,
  kind: c.kind,
  description: c.description,
  params: c.params,
  pins: c.pins.map(compactPin),
  ...(c.verified ? {} : { verified: false }),
});

async function allBoards(ctx: ToolContext): Promise<BoardDef[]> {
  return [...builtinBoards, ...(await ctx.store.list())];
}

/** Найти плату по id / названию / алиасу среди встроенных и сгенерированных. */
export async function resolveBoard(
  ctx: ToolContext,
  idOrName: string,
): Promise<BoardDef | undefined> {
  return findBoardIn(await allBoards(ctx), idOrName);
}

const CalcInput = z.object({ type: z.string(), inputs: z.record(z.string(), z.number()) });

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'list_boards': {
      const list = await allBoards(ctx);
      return {
        ok: true,
        content: json({ boards: list.map(boardSummary) }),
        summary: `${list.length}`,
      };
    }
    case 'get_board': {
      const id = String(args.boardId ?? '');
      const board = await resolveBoard(ctx, id);
      if (!board) {
        const ids = (await allBoards(ctx)).map((b) => b.id);
        return fail(
          `Unknown board "${id}"`,
          {
            availableBoards: ids,
            hint: 'Use one of availableBoards, or call ensure_board if the user needs a board that is not in the library.',
          },
          `✕ ${id}`,
        );
      }
      return {
        ok: true,
        summary: board.name,
        content: json({
          ...boardSummary(board),
          supply: board.supply,
          rails: board.rails,
          maxTotalCurrentMa: board.maxTotalCurrentMa,
          selfCurrentMa: board.selfCurrentMa,
          flexibleMux: board.flexibleMux,
          ...(board.verified
            ? {}
            : {
                warning:
                  'This pinout was written by AI and is not verified; mention it in project warnings.',
                provenance: board.provenance,
              }),
          pins: board.pins.map(compactPin),
        }),
      };
    }
    case 'ensure_board': {
      if (!ctx.generateBoardDraft)
        return fail('Generating boards is not available. Pick a board from list_boards.');
      const query = String(args.name ?? '').trim();
      if (query.length < 2) return fail('name is required');
      try {
        const r = await ensureBoard({ query, store: ctx.store, generate: ctx.generateBoardDraft });
        return {
          ok: true,
          summary: `${r.board.name}${r.status === 'generated' ? ' (new)' : ''}`,
          content: json({
            status: r.status,
            board: boardSummary(r.board),
            warnings: r.warnings,
            next: `Call get_board with boardId "${r.board.id}".`,
          }),
        };
      } catch (e) {
        if (e instanceof BoardGenerationError) return fail(e.message, { problems: e.problems });
        throw e;
      }
    }
    case 'search_components': {
      const query = String(args.query ?? '');
      const category = typeof args.category === 'string' ? args.category : undefined;
      let found = searchComponents(query, category);
      if (!found.length && query)
        found = query
          .split(/\s+/)
          .flatMap((w) => searchComponents(w, category))
          .filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i);
      const top = found.slice(0, 8);
      return {
        ok: true,
        summary: `${top.length}: ${top.map((c) => c.id).join(', ')}`,
        content: json({
          components: top.map(componentView),
          ...(top.length
            ? {}
            : {
                note:
                  'No match. Categories: ' +
                  [...new Set(components.map((c) => c.category))].join(', ') +
                  '. Try broader words.',
              }),
        }),
      };
    }
    case 'calculate': {
      const parsed = CalcInput.safeParse(args);
      if (!parsed.success)
        return fail('Invalid arguments: expected { type, inputs: { name: number } }', {
          issues: parsed.error.issues.map((i) => i.message),
        });
      try {
        const r = calculate(parsed.data.type, parsed.data.inputs);
        return { ok: true, summary: `${r.type} → ${r.result} ${r.unit}`, content: json(r) };
      } catch (e) {
        if (e instanceof CalcError) return fail(e.message, { issues: e.issues }, `✕ ${e.message}`);
        throw e;
      }
    }
    default:
      return fail(`Unknown tool "${name}". Available: ${TOOL_NAMES.join(', ')}`);
  }
}

// ───────── проверка итогового проекта ─────────

export interface ProjectCheck {
  ok: boolean;
  project?: Project;
  report?: ErcReport;
  /** Что вернуть модели на исправление. */
  problems: string[];
}

/** create_project: Zod → ссылки на библиотеку → ERC. */
export async function checkProject(raw: unknown, ctx: ToolContext): Promise<ProjectCheck> {
  const parsed = Project.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      problems: parsed.error.issues
        .slice(0, 25)
        .map((i) => `schema: ${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  const project = parsed.data;

  const board = await resolveBoard(ctx, project.boardId);
  if (!board)
    return {
      ok: false,
      project,
      problems: [`boardId "${project.boardId}" is not in the library. Use an id from list_boards.`],
    };
  // validateProjectRefs знает только встроенные платы, поэтому ссылки на пины платы проверяем здесь (в т.ч. для плат ИИ)
  const refIssues = validateProjectRefs(project).filter(
    (i) => i.path !== 'boardId' && !i.message.startsWith('"board" has no pin'),
  );
  const boardPinIssues = project.connections.flatMap((c, i) =>
    (['from', 'to'] as const).flatMap((side) => {
      const ref = c[side].split(':')[0];
      const pin = c[side].slice(c[side].indexOf(':') + 1);
      return ref === 'board' && !board.pins.some((p) => p.id === pin)
        ? [
            {
              path: `connections[${i}].${side}`,
              message: `board "${board.id}" has no pin "${pin}"`,
            },
          ]
        : [];
    }),
  );
  const refs = [...refIssues, ...boardPinIssues];
  if (refs.length)
    return {
      ok: false,
      project,
      problems: refs.slice(0, 25).map((i) => `reference: ${i.path}: ${i.message}`),
    };

  const report = runErc(project, { board, getComponent });
  return { ok: report.ok, project, report, problems: violationsForAi(report) };
}
