import { z } from 'zod';
import { compareToInventory, type Inventory, type InventoryFit } from '../inventory';
import { Connection, PartInstance, Project, type BoardDef } from '../schema';
import type { ErcReport } from '../erc';

/** Черновик устройства: только то, что нужно для схемы. Расчёты, BOM и предупреждения добавит полноценная генерация. */
export const VariantDraft = z.object({
  parts: z.array(PartInstance).max(40),
  connections: z.array(Connection).max(120),
  power: z.object({
    source: z.string(),
    voltage: z.number().positive(),
    budgetMa: z.number().nonnegative(),
  }),
  codeHints: z
    .object({ libraries: z.array(z.string()), pinMap: z.record(z.string(), z.string()) })
    .optional(),
});
export type VariantDraft = z.infer<typeof VariantDraft>;

export const VariantInput = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'id must be kebab-case'),
  title: z.string().min(3).max(80),
  summary: z.string().min(10).max(400),
  difficulty: z.number().int().min(1).max(5),
  buildMinutes: z.number().int().min(5).max(600),
  boardId: z.string().min(1),
  draft: VariantDraft,
});
export type VariantInput = z.infer<typeof VariantInput>;

export const VariantsInput = z.object({ variants: z.array(VariantInput).min(1).max(8) });
export type VariantsInput = z.infer<typeof VariantsInput>;

/** Черновик варианта как обычный проект (для проверки, превью и мгновенного открытия). */
export function draftToProject(v: VariantInput): Project {
  return Project.parse({
    title: v.title,
    description: v.summary,
    boardId: v.boardId,
    parts: v.draft.parts,
    connections: v.draft.connections,
    power: v.draft.power,
    calculations: [],
    bom: [],
    warnings: [],
    ...(v.draft.codeHints && { codeHints: v.draft.codeHints }),
  });
}

export type VariantMode = 'stock' | 'purchase';

/** Принятый вариант: прошёл схему, ссылки на библиотеку и ERC. */
export interface Variant {
  id: string;
  title: string;
  summary: string;
  difficulty: number;
  buildMinutes: number;
  boardId: string;
  /** Черновик проекта (схема без расчётов). */
  project: Project;
  fit: InventoryFit;
  /** stock — собирается только из имеющегося; purchase — нужна докупка (список в fit.buy). */
  mode: VariantMode;
  /** Предупреждения ERC черновика (ошибок нет — иначе вариант не принят). */
  ercWarnings: number;
}

/** Предел «минимальной докупки»: не больше стольких позиций и такой суммы. */
export const MAX_PURCHASE_ITEMS = 3;
export const MAX_PURCHASE_USD = 25;
export const MIN_VARIANTS = 3;

export interface VariantCheckEnv {
  inventory: Inventory;
  /** Проверка черновика как проекта: схема → ссылки → ERC (см. checkProject). */
  checkProject: (
    project: Project,
  ) => Promise<{ ok: boolean; project?: Project; report?: ErcReport; problems: string[] }>;
  getBoard: (id: string) => BoardDef | undefined | Promise<BoardDef | undefined>;
}

export interface VariantCheck {
  accepted: Variant[];
  /** Блокирующие замечания по id варианта (то, что нужно исправить модели). */
  problems: Record<string, string[]>;
  /** Общие замечания к набору (мало вариантов, дубликаты id). */
  general: string[];
}

/**
 * Детерминированная проверка набора вариантов от ИИ: схема Zod, библиотека, ERC черновика,
 * состав относительно запасов (докупка должна быть минимальной), уникальность id.
 */
export async function checkVariants(raw: unknown, env: VariantCheckEnv): Promise<VariantCheck> {
  const parsed = VariantsInput.safeParse(raw);
  if (!parsed.success) {
    const problems: Record<string, string[]> = {};
    const general = parsed.error.issues
      .slice(0, 15)
      .map((i) => `schema: ${i.path.join('.') || '(root)'}: ${i.message}`);
    // привязываем замечания к вариантам по индексу, когда это возможно
    for (const i of parsed.error.issues) {
      if (i.path[0] === 'variants' && typeof i.path[1] === 'number') {
        const id = String(
          (raw as { variants?: { id?: string }[] })?.variants?.[i.path[1]]?.id ??
            `#${i.path[1] + 1}`,
        );
        (problems[id] ??= []).push(`${i.path.slice(2).join('.')}: ${i.message}`);
      }
    }
    return { accepted: [], problems, general: Object.keys(problems).length ? [] : general };
  }

  const general: string[] = [];
  const problems: Record<string, string[]> = {};
  const accepted: Variant[] = [];
  const seen = new Set<string>();

  for (const input of parsed.data.variants) {
    if (seen.has(input.id)) {
      general.push(`duplicate variant id "${input.id}"`);
      continue;
    }
    seen.add(input.id);
    const project = draftToProject(input);
    const check = await env.checkProject(project);
    const list: string[] = [...check.problems];
    if (check.ok && check.project) {
      const board = await env.getBoard(check.project.boardId);
      const fit = compareToInventory(check.project, board, env.inventory);
      if (fit.buy.length > MAX_PURCHASE_ITEMS || fit.costUsd > MAX_PURCHASE_USD)
        list.push(
          `needs too much extra hardware (${fit.buy.length} items, ≈$${fit.costUsd}): ${fit.buy.map((b) => `${b.qty}× ${b.name}${b.value ? ' ' + b.value : ''}`).join(', ')}. ` +
            `Redesign using the user's inventory; allow at most ${MAX_PURCHASE_ITEMS} extra items.`,
        );
      if (!list.length)
        accepted.push({
          id: input.id,
          title: input.title,
          summary: input.summary,
          difficulty: input.difficulty,
          buildMinutes: input.buildMinutes,
          boardId: input.boardId,
          project: check.project,
          fit,
          mode: fit.fromStock ? 'stock' : 'purchase',
          ercWarnings: (check.report?.counts.warning ?? 0) + (check.report?.counts.danger ?? 0),
        });
    }
    if (list.length) problems[input.id] = list;
  }
  if (accepted.length < MIN_VARIANTS)
    general.push(
      `only ${accepted.length} valid variants; provide at least ${MIN_VARIANTS} different ones`,
    );
  return { accepted, problems, general };
}

/** Сортировка для показа: сначала собираемые только из запасов, затем по сложности. */
export const sortVariants = (list: Variant[]): Variant[] =>
  [...list].sort(
    (a, b) =>
      Number(b.mode === 'stock') - Number(a.mode === 'stock') ||
      a.difficulty - b.difficulty ||
      a.fit.costUsd - b.fit.costUsd,
  );
