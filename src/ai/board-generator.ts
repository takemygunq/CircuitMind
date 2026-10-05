import { boards as builtinBoards, findBoardIn } from '@/core/library';
import { compileBoardDraft } from '@/core/library/compile-draft';
import { lintBoard } from '@/core/library/lint-board';
import type { BoardStore } from '@/core/library/store';
import { BoardDraft, type BoardDef } from '@/core/schema';

export interface DraftRequest {
  request: string;
  existingIds: string[];
  previous?: unknown;
  problems?: string[];
}
/** Возвращает сырой черновик от модели (ещё не проверенный). */
export type DraftGenerator = (input: DraftRequest) => Promise<unknown>;

export interface EnsureBoardResult {
  status: 'found' | 'generated';
  board: BoardDef;
  /** Предупреждения линтера — показываются пользователем рядом с «непроверенной» плашкой. */
  warnings: string[];
  attempts: number;
}

export class BoardGenerationError extends Error {
  constructor(
    message: string,
    readonly problems: string[],
  ) {
    super(message);
    this.name = 'BoardGenerationError';
  }
}

function zodProblems(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues
    .slice(0, 20)
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`);
}

/**
 * Если платы нет в библиотеке — просит ИИ описать её (BoardDraft), детерминированно
 * компилирует в BoardDef, проверяет линтером, при ошибках возвращает их ИИ (до maxAttempts),
 * сохраняет в хранилище и только потом отдаёт плату на отрисовку.
 */
export async function ensureBoard(opts: {
  query: string;
  store: BoardStore;
  generate: DraftGenerator;
  builtin?: readonly BoardDef[];
  maxAttempts?: number;
}): Promise<EnsureBoardResult> {
  const { query, store, generate, builtin = builtinBoards, maxAttempts = 3 } = opts;

  const stored = await store.list();
  const known = [...builtin, ...stored];
  const hit = findBoardIn(known, query);
  if (hit) return { status: 'found', board: hit, warnings: [], attempts: 0 };

  const existingIds = known.map((b) => b.id);
  let previous: unknown;
  let problems: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await generate({ request: query, existingIds, previous, problems });
    previous = raw;

    const parsed = BoardDraft.safeParse(raw);
    if (!parsed.success) {
      problems = zodProblems(parsed.error);
      continue;
    }

    let board: BoardDef;
    try {
      board = compileBoardDraft(parsed.data);
    } catch (e) {
      problems = e instanceof Error && 'issues' in e ? zodProblems(e as never) : [String(e)];
      continue;
    }

    if (existingIds.includes(board.id)) {
      problems = [
        `id "${board.id}" already exists in the library — choose a different id for this board`,
      ];
      continue;
    }
    const lint = lintBoard(board);
    if (lint.errors.length) {
      problems = lint.errors;
      continue;
    }

    await store.save(board);
    return { status: 'generated', board, warnings: lint.warnings, attempts: attempt };
  }
  throw new BoardGenerationError(
    `Could not generate a valid board "${query}" in ${maxAttempts} attempts`,
    problems,
  );
}
