import type { BoardDef } from '../schema';

/** Хранилище сгенерированных плат. Сейчас — файлы (server), в Фазе 9 — Postgres. */
export interface BoardStore {
  list(): Promise<BoardDef[]>;
  get(id: string): Promise<BoardDef | undefined>;
  save(board: BoardDef): Promise<void>;
}

export class MemoryBoardStore implements BoardStore {
  private readonly items = new Map<string, BoardDef>();
  async list() {
    return [...this.items.values()];
  }
  async get(id: string) {
    return this.items.get(id);
  }
  async save(board: BoardDef) {
    this.items.set(board.id, board);
  }
}
