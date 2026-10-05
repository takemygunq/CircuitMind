import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { weatherEsp32 } from '@/core/fixtures';
import { MemoryBoardStore } from '@/core/library/store';
import { AgentError, type AgentEvent } from './events';
import { createMockModelClient } from './mock-client';
import { runAgent } from './run';
import { scriptedClient, textBlock, toolUse, type TurnScript } from './scripted';
import { AGENT_SYSTEM_PROMPT, userMessage } from './system-prompt';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const good = () => clone(weatherEsp32);
const broken = () => {
  const p = clone(weatherEsp32);
  p.parts = p.parts.filter((x) => x.instanceId !== 'R1');
  p.connections = p.connections.filter(
    (c) => !c.from.startsWith('R1:') && !c.to.startsWith('R1:') && c.from !== 'board:GPIO18',
  );
  p.connections.push({ from: 'board:GPIO18', to: 'led1:anode' });
  return p;
};

function run(script: TurnScript[], overrides: Partial<Parameters<typeof runAgent>[0]> = {}) {
  const client = scriptedClient(script);
  const events: AgentEvent[] = [];
  const promise = runAgent({
    client,
    ctx: { store: new MemoryBoardStore() },
    request: { prompt: 'weather station', locale: 'ru' },
    emit: (e) => events.push(e),
    ...overrides,
  });
  return { client, events, promise };
}
const lastUser = (client: ReturnType<typeof scriptedClient>, i: number) =>
  client.requests[i].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];

describe('runAgent', () => {
  it('accepts a correct project on the first try', async () => {
    const { promise, events, client } = run([{ content: [toolUse('create_project', good())] }]);
    const r = await promise;
    expect(r).toMatchObject({ ok: true, repairs: 0, turns: 1, model: 'scripted-model' });
    expect(r.project?.title).toBe(weatherEsp32.title);
    expect(r.report?.counts.error).toBe(0);
    expect(client.requests).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(['start', 'turn', 'tool', 'erc', 'tool']);
    expect(events.find((e) => e.type === 'erc')).toMatchObject({ ok: true, attempt: 1 });
  });

  it('sends ERC errors back to the model and accepts the repaired project', async () => {
    const { promise, events, client } = run([
      { content: [toolUse('create_project', broken())] },
      { content: [toolUse('create_project', good())] },
    ]);
    const r = await promise;
    expect(r).toMatchObject({ ok: true, repairs: 1, turns: 2 });
    const feedback = lastUser(client, 1)[0];
    expect(feedback.is_error).toBe(true);
    expect(String(feedback.content)).toContain('led_no_resistor');
    expect(String(feedback.content)).toContain('call create_project again');
    expect(events.filter((e) => e.type === 'erc').map((e) => (e as { ok: boolean }).ok)).toEqual([
      false,
      true,
    ]);
    expect(events).toContainEqual({ type: 'repair', attempt: 1, max: 3 });
  });

  it('gives up after maxRepairs and still returns the project for the UI to flag', async () => {
    const { promise, events, client } = run([{ content: [toolUse('create_project', broken())] }]);
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.project).not.toBeNull();
    expect(r.report?.violations.some((v) => v.rule === 'led_no_resistor')).toBe(true);
    expect(r.repairs).toBe(3);
    expect(client.requests).toHaveLength(4); // 1 попытка + 3 исправления
    expect(events.filter((e) => e.type === 'repair')).toHaveLength(3);
  });

  it('returns schema problems to the model and recovers', async () => {
    const { promise, client } = run([
      { content: [toolUse('create_project', { title: 'x' })] },
      { content: [toolUse('create_project', good())] },
    ]);
    expect((await promise).ok).toBe(true);
    expect(String(lastUser(client, 1)[0].content)).toContain('schema:');
  });

  it('reports schema problems when the model never fixes them', async () => {
    const { promise } = run([{ content: [toolUse('create_project', { nope: 1 })] }], {
      maxRepairs: 1,
    });
    const r = await promise;
    expect(r).toMatchObject({ ok: false, project: null, report: null });
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.problems[0]).toMatch(/^schema: /);
  });

  it('runs library tools in parallel and answers all of them in one message', async () => {
    const calls = [
      toolUse('list_boards', {}),
      toolUse('get_board', { boardId: 'esp32-devkit-v1' }),
      toolUse('search_components', { query: 'oled', category: null }),
      toolUse('calculate', { type: 'led_resistor', inputs: { vccV: 3.3, vfV: 2, ifMa: 6 } }),
    ];
    const { promise, client, events } = run([
      { content: calls },
      { content: [toolUse('create_project', good())] },
    ]);
    expect((await promise).ok).toBe(true);
    const results = lastUser(client, 1);
    expect(results.map((r) => r.tool_use_id)).toEqual(calls.map((c) => c.id));
    expect(results.every((r) => !r.is_error)).toBe(true);
    expect(String(results[3].content)).toContain('220');
    expect(
      events.filter((e) => e.type === 'tool' && e.status === 'ok').length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('turns unknown tools and tool errors into error results', async () => {
    const { promise, client } = run([
      { content: [toolUse('format_disk', {}), toolUse('get_board', { boardId: 'nope' })] },
      { content: [toolUse('create_project', good())] },
    ]);
    await promise;
    const results = lastUser(client, 1);
    expect(results.every((r) => r.is_error)).toBe(true);
    expect(String(results[0].content)).toContain('Unknown tool');
  });

  it('survives a tool that throws', async () => {
    const store = new MemoryBoardStore();
    store.list = async () => {
      throw new Error('disk on fire');
    };
    const { promise, client } = run(
      [{ content: [toolUse('list_boards', {})] }, { content: [toolUse('create_project', good())] }],
      { ctx: { store } },
    );
    // create_project тоже падает на store.list → это уже внутренняя ошибка сервера
    await expect(promise).rejects.toThrow('disk on fire');
    expect(String(lastUser(client, 1)[0].content)).toContain('Internal error');
  });

  it('answers calls cut off by max_tokens with an error and lets the model retry', async () => {
    const { promise, client } = run([
      { content: [toolUse('create_project', { title: 'cut' })], stopReason: 'max_tokens' },
      { content: [toolUse('create_project', good())] },
    ]);
    const r = await promise;
    expect(r.ok).toBe(true);
    expect(String(lastUser(client, 1)[0].content)).toContain('cut off');
    expect(r.repairs).toBe(0); // обрыв — не ошибка проекта
  });

  it('passes assistant content back unchanged (thinking blocks included)', async () => {
    const thinking = {
      type: 'thinking',
      thinking: '',
      signature: 'sig',
    } as unknown as Anthropic.ContentBlock;
    const first = [thinking, textBlock('plan'), toolUse('list_boards', {})];
    const { promise, client } = run([
      { content: first },
      { content: [toolUse('create_project', good())] },
    ]);
    await promise;
    expect(client.requests[1].messages[1]).toEqual({ role: 'assistant', content: first });
  });

  it('nudges once when the model forgets to call create_project', async () => {
    const { promise, client } = run([
      { content: [textBlock('Here is my plan...')] },
      { content: [toolUse('create_project', good())] },
    ]);
    expect((await promise).ok).toBe(true);
    expect(String(client.requests[1].messages.at(-1)!.content)).toContain('create_project');
    await expect(run([{ content: [textBlock('no')] }]).promise).rejects.toMatchObject({
      code: 'no_project',
    });
  });

  it('stops on refusal, budget overrun, turn limit and abort', async () => {
    await expect(run([{ content: [], stopReason: 'refusal' }]).promise).rejects.toMatchObject({
      code: 'refused',
    });
    await expect(
      run([{ content: [toolUse('list_boards', {})], usage: { output: 500_000 } }]).promise,
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
    await expect(
      run([{ content: [toolUse('list_boards', {})] }], { maxTurns: 3 }).promise,
    ).rejects.toMatchObject({ code: 'no_project' });
    const ac = new AbortController();
    ac.abort();
    await expect(
      run([{ content: [toolUse('list_boards', {})] }], { signal: ac.signal }).promise,
    ).rejects.toThrow();
  });

  it('sums token usage across turns', async () => {
    const { promise } = run([
      { content: [toolUse('list_boards', {})], usage: { input: 100, output: 10, cacheRead: 50 } },
      {
        content: [toolUse('create_project', good())],
        usage: { input: 200, output: 40, cacheRead: 150 },
      },
    ]);
    expect((await promise).usage).toEqual({
      inputTokens: 300,
      outputTokens: 50,
      cacheReadTokens: 200,
    });
  });

  it('streams assistant text', async () => {
    const { promise, events } = run([
      { content: [textBlock('Thinking about pins'), toolUse('create_project', good())] },
    ]);
    await promise;
    expect(events).toContainEqual({ type: 'text', delta: 'Thinking about pins' });
  });

  it('offers ensure_board only when board generation is configured', async () => {
    const without = run([{ content: [toolUse('create_project', good())] }]);
    await without.promise;
    expect(without.client.requests[0].tools.map((t) => t.name)).not.toContain('ensure_board');
    const withGen = run([{ content: [toolUse('create_project', good())] }], {
      ctx: { store: new MemoryBoardStore(), generateBoardDraft: async () => null },
    });
    await withGen.promise;
    expect(withGen.client.requests[0].tools.map((t) => t.name)).toContain('ensure_board');
  });
});

describe('mock model client', () => {
  it('demonstrates the whole loop: tools → ERC failure → repair → accepted', async () => {
    const events: AgentEvent[] = [];
    const r = await runAgent({
      client: createMockModelClient(),
      ctx: { store: new MemoryBoardStore() },
      request: { prompt: 'x', locale: 'ru' },
      emit: (e) => events.push(e),
    });
    expect(r).toMatchObject({ ok: true, repairs: 1, model: 'mock-model' });
    expect(events.filter((e) => e.type === 'erc')).toHaveLength(2);
    expect(
      events.filter(
        (e) => e.type === 'tool' && e.name === 'search_components' && e.status === 'ok',
      ),
    ).toHaveLength(2);
  });
});

describe('prompts', () => {
  it('system prompt encodes the key engineering rules', () => {
    for (const phrase of [
      'calculate',
      'create_project',
      'flyback',
      'level',
      'danger',
      'E24',
      'library',
    ])
      expect(AGENT_SYSTEM_PROMPT).toContain(phrase);
  });
  it('user message carries request, board and language', () => {
    const m = userMessage({
      prompt: ' weather station ',
      boardId: 'esp32-devkit-v1',
      locale: 'uk',
    });
    expect(m).toContain('weather station');
    expect(m).toContain('esp32-devkit-v1');
    expect(m).toContain('Ukrainian');
    expect(userMessage({ prompt: 'x', locale: 'en' })).toContain('choose the most suitable');
  });
  it('AgentError carries a code', () => {
    expect(new AgentError('timeout', 'slow')).toMatchObject({
      code: 'timeout',
      name: 'AgentError',
    });
  });
});
