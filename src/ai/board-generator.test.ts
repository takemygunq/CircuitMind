import { describe, expect, it, vi } from 'vitest';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { MemoryBoardStore } from '@/core/library/store';
import { BoardDraft } from '@/core/schema';
import { renderBoardSvg } from '@/diagram/board-art/render';
import { makeNanoDraft } from './__fixtures__/nano-draft';
import { BoardGenerationError, ensureBoard, type DraftGenerator } from './board-generator';

const gen = (...responses: unknown[]) => vi.fn<DraftGenerator>(async () => responses.shift());

describe('ensureBoard', () => {
  it('returns library boards without calling the model', async () => {
    const generate = gen();
    const r = await ensureBoard({
      query: 'Arduino UNO R3',
      store: new MemoryBoardStore(),
      generate,
    });
    expect(r.status).toBe('found');
    expect(r.board.id).toBe('arduino-uno');
    expect(generate).not.toHaveBeenCalled();
  });

  it('generates a missing board, stores it, and reuses it next time', async () => {
    const store = new MemoryBoardStore();
    const generate = gen(makeNanoDraft());
    const r = await ensureBoard({ query: 'Arduino Nano', store, generate });
    expect(r.status).toBe('generated');
    expect(r.attempts).toBe(1);
    expect(r.board).toMatchObject({ id: 'arduino-nano', verified: false, source: 'ai' });
    expect(r.board.pins).toHaveLength(30);
    expect((await store.get('arduino-nano'))?.generatedAt).toBeTruthy();

    const again = await ensureBoard({ query: 'nano', store, generate });
    expect(again.status).toBe('found');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('computes pin coordinates from header origin and pitch', async () => {
    const r = await ensureBoard({
      query: 'nano',
      store: new MemoryBoardStore(),
      generate: gen(makeNanoDraft()),
    });
    const d12 = r.board.pins.find((p) => p.id === 'D12')!;
    const d11 = r.board.pins.find((p) => p.id === 'D11')!;
    expect(d12.position).toEqual({ x: 3.8, y: 1.7 });
    expect(d11.position.x).toBeCloseTo(6.34, 2);
    expect(r.board.pins.find((p) => p.id === 'VIN')!.position).toEqual({ x: 39.36, y: 16.8 });
  });

  it('feeds validator errors back to the model and retries', async () => {
    const bad = makeNanoDraft();
    bad.headers[0].pins[0].voltage = 3.3; // GPIO D12 на 5 В плате
    const generate = gen(bad, makeNanoDraft());
    const r = await ensureBoard({ query: 'nano', store: new MemoryBoardStore(), generate });
    expect(r.attempts).toBe(2);
    expect(generate.mock.calls[1][0].problems?.join('\n')).toMatch(/D12.*voltage/);
    expect(generate.mock.calls[1][0].previous).toBe(bad);
  });

  it('retries on malformed drafts', async () => {
    const generate = gen(null, { id: 'x' }, makeNanoDraft());
    const r = await ensureBoard({ query: 'nano', store: new MemoryBoardStore(), generate });
    expect(r.attempts).toBe(3);
    expect(generate.mock.calls[2][0].problems?.length).toBeGreaterThan(0);
  });

  it('rejects chips covering pins', async () => {
    const bad = makeNanoDraft();
    bad.art.parts.push({ type: 'chip', package: 'qfp', label: 'X', x: 10, y: 1.7, w: 7, h: 4 });
    const generate = gen(bad, makeNanoDraft());
    await ensureBoard({ query: 'nano', store: new MemoryBoardStore(), generate });
    expect(generate.mock.calls[1][0].problems?.join('\n')).toMatch(/covers pin/);
  });

  it('refuses ids that already exist', async () => {
    const dup = { ...makeNanoDraft(), id: 'arduino-uno' };
    const err = await ensureBoard({
      query: 'nano',
      store: new MemoryBoardStore(),
      generate: gen(dup, dup, dup),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BoardGenerationError);
    expect(err.problems.join()).toMatch(/already exists/);
  });

  it('gives up after maxAttempts and stores nothing', async () => {
    const store = new MemoryBoardStore();
    const generate = gen(null, null, null);
    const err = await ensureBoard({ query: 'nano', store, generate }).catch((e) => e);
    expect(err).toBeInstanceOf(BoardGenerationError);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(await store.list()).toEqual([]);
  });

  it('renders a generated board from the stored definition', async () => {
    const store = new MemoryBoardStore();
    await ensureBoard({ query: 'nano', store, generate: gen(makeNanoDraft()) });
    const svg = renderBoardSvg((await store.get('arduino-nano'))!);
    expect(svg.match(/class="pin"/g)).toHaveLength(30);
    expect(svg).not.toMatch(/NaN|undefined/);
  });
});

describe('BoardDraft structured output schema', () => {
  it('converts to a JSON schema for the Messages API', () => {
    const fmt = zodOutputFormat(BoardDraft);
    expect(fmt.type).toBe('json_schema');
    expect(JSON.stringify(fmt.schema)).toContain('headers');
  });
});
