import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createMockModelClient } from '@/ai/agent/mock-client';
import { scriptedClient, textBlock, toolUse } from '@/ai/agent/scripted';
import { AgentError, type AgentEvent } from '@/ai/agent/events';
import { weatherEsp32 } from '@/core/fixtures';
import { MemoryBoardStore } from '@/core/library/store';
import { BusyError, GenerationService, ResultCache, requestKey, toErrorEvent } from './generation';

const req = { prompt: 'Weather station', locale: 'en' as const };
const ctx = () => ({ store: new MemoryBoardStore() });
const finished = (run: ReturnType<GenerationService['start']>) =>
  new Promise<AgentEvent[]>((resolve) => {
    const seen: AgentEvent[] = [];
    run.subscribe((e) => {
      seen.push(e);
      if (e.type === 'done' || e.type === 'error') resolve(seen);
    });
  });

describe('ResultCache', () => {
  const result = { ok: true } as never;
  it('expires entries and evicts the oldest', () => {
    const c = new ResultCache(1000, 2);
    c.set('a', result, 0);
    expect(c.get('a', 500)).toBe(result);
    expect(c.get('a', 1500)).toBeUndefined();
    c.set('b', result, 0);
    c.set('c', result, 0);
    c.set('d', result, 0);
    expect(c.size).toBe(2);
    expect(c.get('b', 1)).toBeUndefined();
  });
});

describe('requestKey', () => {
  it('ignores case and whitespace but not board, language or model', () => {
    const k = requestKey(req, 'm');
    expect(requestKey({ ...req, prompt: '  weather   STATION ' }, 'm')).toBe(k);
    expect(requestKey({ ...req, boardId: 'x' }, 'm')).not.toBe(k);
    expect(requestKey({ ...req, locale: 'ru' }, 'm')).not.toBe(k);
    expect(requestKey(req, 'other')).not.toBe(k);
  });
});

describe('GenerationService', () => {
  it('runs the agent, replays history to late subscribers and caches successes', async () => {
    const service = new GenerationService({
      makeClient: () => createMockModelClient(),
      ctx: ctx(),
    });
    const run = service.start(req);
    const live = await finished(run);
    expect(live.at(-1)).toMatchObject({ type: 'done', result: { ok: true, repairs: 1 } });
    expect((await finished(run)).length).toBe(live.length); // подписка после завершения получает всю историю

    const again = await finished(service.start({ ...req, prompt: 'weather STATION' }));
    expect(again[0]).toMatchObject({ type: 'start', cached: true });
    expect(again.at(-1)).toMatchObject({ type: 'done', result: { cached: true, ok: true } });
  });

  it('shares one run between identical parallel requests', async () => {
    let turns = 0;
    const client = scriptedClient([
      () => (
        turns++,
        { content: [toolUse('create_project', JSON.parse(JSON.stringify(weatherEsp32)))] }
      ),
    ]);
    const service = new GenerationService({ makeClient: () => client, ctx: ctx() });
    const a = service.start(req);
    const b = service.start(req);
    expect(b).toBe(a);
    await Promise.all([finished(a), finished(b)]);
    expect(turns).toBe(1);
  });

  it('does not cache projects that failed ERC', async () => {
    const bad = JSON.parse(JSON.stringify(weatherEsp32));
    bad.connections.push({ from: 'board:3V3', to: 'board:GND1' }); // короткое замыкание
    const service = new GenerationService({
      makeClient: () => scriptedClient([{ content: [toolUse('create_project', bad)] }]),
      ctx: ctx(),
    });
    const events = await finished(service.start(req));
    expect(events.at(-1)).toMatchObject({ type: 'done', result: { ok: false } });
    const second = await finished(service.start(req));
    expect(second[0]).toMatchObject({ type: 'start' });
    expect((second[0] as { cached?: boolean }).cached).toBeUndefined();
  });

  it('limits concurrent runs', () => {
    const never = scriptedClient([() => new Promise(() => {}) as never]);
    const stuck = { ...never, model: 'm', turn: () => new Promise<never>(() => {}) };
    const service = new GenerationService({
      makeClient: () => stuck,
      ctx: ctx(),
      maxConcurrent: 1,
    });
    service.start(req);
    expect(() => service.start({ ...req, prompt: 'another one' })).toThrow(BusyError);
    expect(service.running).toBe(1);
  });

  it('aborts when the last viewer leaves, and on timeout', async () => {
    let aborted = false;
    const slow = {
      model: 'm',
      turn: ({ signal }: { signal?: AbortSignal }) =>
        new Promise<never>((_, reject) =>
          signal?.addEventListener(
            'abort',
            () => ((aborted = true), reject(new DOMException('x', 'AbortError'))),
          ),
        ),
    };
    const service = new GenerationService({ makeClient: () => slow, ctx: ctx() });
    const run = service.start(req);
    const off = run.subscribe(() => {});
    off();
    await new Promise((r) => setTimeout(r, 10));
    expect(aborted).toBe(true);

    const timed = new GenerationService({ makeClient: () => slow, ctx: ctx(), timeoutMs: 20 });
    const events = await finished(timed.start({ ...req, prompt: 'slow one' }));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'timeout' });
  });

  it('turns agent failures into error events', async () => {
    const service = new GenerationService({
      makeClient: () => scriptedClient([{ content: [textBlock('hi')] }]),
      ctx: ctx(),
    });
    expect((await finished(service.start(req))).at(-1)).toMatchObject({
      type: 'error',
      code: 'no_project',
    });
  });
});

describe('toErrorEvent', () => {
  it('maps SDK and agent errors to client codes', () => {
    const headers = new Headers();
    expect(toErrorEvent(new AgentError('refused', 'no'))).toMatchObject({ code: 'refused' });
    expect(
      toErrorEvent(
        new Anthropic.AuthenticationError(
          401,
          { error: { message: 'bad key' } },
          'bad key',
          headers,
        ),
      ),
    ).toMatchObject({ code: 'ai_not_configured' });
    expect(
      toErrorEvent(
        new Anthropic.RateLimitError(429, { error: { message: 'slow' } }, 'slow', headers),
      ),
    ).toMatchObject({ code: 'ai_rate_limited' });
    expect(
      toErrorEvent(
        new Anthropic.BadRequestError(400, { error: { message: 'bad' } }, 'bad', headers),
      ),
    ).toMatchObject({ code: 'invalid_request' });
    expect(toErrorEvent(new Error('Could not resolve authentication method'))).toMatchObject({
      code: 'ai_not_configured',
    });
    expect(toErrorEvent(new DOMException('x', 'AbortError'))).toMatchObject({ code: 'aborted' });
    expect(toErrorEvent(new Error('x'), true)).toMatchObject({ code: 'timeout' });
  });
});
