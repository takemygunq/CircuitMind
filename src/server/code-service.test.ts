import { describe, expect, it } from 'vitest';
import { scriptedClient, toolUse } from '@/ai/agent/scripted';
import type { CodeEvent } from '@/ai/code/events';
import { templateBody, buildPinBindings } from '@/core/code';
import { weatherEsp32 } from '@/core/fixtures';
import { getBoard } from '@/core/library';
import type { CodeRequest } from '@/ai/code/run';
import { CodeService, codeRequestKey } from './code-service';

const board = getBoard('esp32-devkit-v1')!;
const body = templateBody(weatherEsp32, board, buildPinBindings(weatherEsp32, board), 'arduino');
const req: CodeRequest = {
  mode: 'generate',
  project: weatherEsp32,
  board,
  language: 'arduino',
  locale: 'ru',
};
const good = () =>
  scriptedClient([
    { content: [toolUse('submit_firmware', { body, explanation: 'ok', libraries: [] })] },
  ]);
const collect = async (svc: CodeService, r = req) => {
  const events: CodeEvent[] = [];
  await svc.run(r, (e) => events.push(e), new AbortController().signal);
  return events;
};

describe('CodeService', () => {
  it('runs the agent and serves identical requests from the cache', async () => {
    let calls = 0;
    const svc = new CodeService({ makeClient: () => (calls++, good()) });
    const first = await collect(svc);
    expect(first.at(-1)).toMatchObject({ type: 'done', result: { ok: true } });
    const second = await collect(svc);
    expect(second[0]).toMatchObject({ type: 'start', cached: true });
    expect(second.at(-1)).toMatchObject({ type: 'done', result: { cached: true } });
    expect(calls).toBe(2); // клиент создаётся для ключа, но модель вызвана один раз
  });

  it('does not cache failed results and keys differ by input', async () => {
    const bad = scriptedClient([
      {
        content: [
          toolUse('submit_firmware', {
            body: body + '\npinMode(27, OUTPUT);',
            explanation: '',
            libraries: [],
          }),
        ],
      },
    ]);
    const svc = new CodeService({ makeClient: () => bad });
    expect((await collect(svc)).at(-1)).toMatchObject({ result: { ok: false } });
    const again = await collect(svc);
    expect((again[0] as { cached?: boolean }).cached).toBeUndefined();
    const k = (over = {}) => codeRequestKey({ ...req, ...over }, 'm');
    expect(k()).toBe(k());
    expect(k({ language: 'micropython' })).not.toBe(k());
    expect(k({ instruction: 'x' })).not.toBe(k());
    expect(k({ code: 'a' })).not.toBe(k({ code: 'b' }));
  });

  it('reports errors as events and respects the concurrency limit', async () => {
    const stuck = { model: 'm', turn: () => new Promise<never>(() => {}) };
    const svc = new CodeService({ makeClient: () => stuck, maxConcurrent: 1, timeoutMs: 30 });
    const running = collect(svc);
    await expect(collect(svc, { ...req, instruction: 'other' })).rejects.toThrow('Too many');
    expect((await running).at(-1)).toMatchObject({ type: 'error', code: 'timeout' });
    const refusing = new CodeService({
      makeClient: () => scriptedClient([{ content: [], stopReason: 'refusal' }]),
    });
    expect((await collect(refusing)).at(-1)).toMatchObject({ type: 'error', code: 'refused' });
  });
});
