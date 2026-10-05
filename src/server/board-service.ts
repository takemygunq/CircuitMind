import { ensureBoard, type DraftGenerator, type EnsureBoardResult } from '@/ai/board-generator';
import { boards as builtinBoards, findBoardIn } from '@/core/library';
import type { BoardStore } from '@/core/library/store';
import type { BoardDef } from '@/core/schema';
import { FileBoardStore } from './file-board-store';
import { resolveDraftGenerator } from './providers/resolve';

export const boardStore: BoardStore = new FileBoardStore();
const store = boardStore;

export async function listAllBoards(): Promise<BoardDef[]> {
  return [...builtinBoards, ...(await store.list())];
}

export async function getAnyBoard(id: string): Promise<BoardDef | undefined> {
  return builtinBoards.find((b) => b.id === id) ?? (await store.get(id));
}

const demoUnavailable: DraftGenerator = async () => {
  throw new Error('Board generation is not available in the demo mode');
};

// Одинаковые одновременные запросы на одну и ту же плату разделяют один вызов модели.
const inflight = new Map<string, Promise<EnsureBoardResult>>();

export function ensureBoardServer(
  query: string,
  generate: DraftGenerator = resolveDraftGenerator() ?? demoUnavailable,
): Promise<EnsureBoardResult> {
  const key = query.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const running = inflight.get(key);
  if (running) return running;
  const p = ensureBoard({ query, store, generate }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export { findBoardIn };
