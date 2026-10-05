import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeNanoDraft } from '@/ai/__fixtures__/nano-draft';
import { compileBoardDraft } from '@/core/library/compile-draft';
import { FileBoardStore } from './file-board-store';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'boards-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('FileBoardStore', () => {
  it('round-trips a board and lists it', async () => {
    const store = new FileBoardStore(path.join(dir, 'nested'));
    const board = compileBoardDraft(makeNanoDraft());
    await store.save(board);
    expect(await store.get('arduino-nano')).toEqual(board);
    expect((await store.list()).map((b) => b.id)).toEqual(['arduino-nano']);
  });

  it('returns nothing for a missing directory or board', async () => {
    const store = new FileBoardStore(path.join(dir, 'none'));
    expect(await store.list()).toEqual([]);
    expect(await store.get('x')).toBeUndefined();
  });

  it('skips corrupt files', async () => {
    await writeFile(path.join(dir, 'bad.json'), '{not json');
    await writeFile(path.join(dir, 'wrong.json'), '{"id":"x"}');
    expect(await new FileBoardStore(dir).list()).toEqual([]);
  });

  it('rejects path traversal ids', async () => {
    const store = new FileBoardStore(dir);
    expect(await store.get('../../etc/passwd')).toBeUndefined();
    await expect(
      store.save({ ...compileBoardDraft(makeNanoDraft()), id: '../evil' }),
    ).rejects.toThrow(/invalid board id/);
  });
});
