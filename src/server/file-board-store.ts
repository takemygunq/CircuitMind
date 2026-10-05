import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BoardDef } from '@/core/schema';
import type { BoardStore } from '@/core/library/store';

/** JSON-файлы в library/generated/boards. Платы ИИ попадают сюда и помечены verified:false. */
export class FileBoardStore implements BoardStore {
  constructor(
    private readonly dir: string = path.join(process.cwd(), 'library', 'generated', 'boards'),
  ) {}

  private file(id: string) {
    // id уже проверен схемой (^[a-z0-9][a-z0-9-]*$) — выход за пределы каталога невозможен
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`invalid board id "${id}"`);
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<BoardDef[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const out: BoardDef[] = [];
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      try {
        out.push(BoardDef.parse(JSON.parse(await fs.readFile(path.join(this.dir, name), 'utf8'))));
      } catch (e) {
        console.warn(`[board-store] skipping invalid ${name}:`, e instanceof Error ? e.message : e);
      }
    }
    return out;
  }

  async get(id: string): Promise<BoardDef | undefined> {
    try {
      return BoardDef.parse(JSON.parse(await fs.readFile(this.file(id), 'utf8')));
    } catch {
      return undefined;
    }
  }

  async save(board: BoardDef): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.file(board.id);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(board, null, 2) + '\n');
    await fs.rename(tmp, target);
  }
}
