import { beforeEach, describe, expect, it } from 'vitest';
import type { CodeEvent } from '@/ai/code/events';
import { templateFirmware } from '@/core/code';
import { blinkUno, weatherEsp32 } from '@/core/fixtures';
import { getBoard } from '@/core/library';
import { codeLimiter, POST } from './route';

const call = (body: unknown, ip = '2.2.2.2') =>
  POST(
    new Request('http://localhost/api/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
const events = async (res: Response): Promise<CodeEvent[]> =>
  (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe('POST /api/code (mock AI)', () => {
  beforeEach(() => {
    process.env.CIRCUITMIND_MOCK_AI = '1';
    codeLimiter.reset();
  });

  it('generates firmware as an NDJSON stream', async () => {
    const res = await call({
      action: 'generate',
      project: weatherEsp32,
      language: 'arduino',
      locale: 'ru',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('ndjson');
    const list = await events(res);
    expect(list[0]).toMatchObject({ type: 'start', mode: 'generate', model: 'mock-model' });
    expect(list.filter((e) => e.type === 'lint')).toHaveLength(2);
    const done = list.at(-1) as Extract<CodeEvent, { type: 'done' }>;
    expect(done.result.ok).toBe(true);
    expect(done.result.code).toContain('void setup()');
    expect(done.result.code).toContain('constexpr auto LED');
  });

  it('edits and explains', async () => {
    const code = templateFirmware(weatherEsp32, getBoard('esp32-devkit-v1')!, 'arduino');
    const edit = (
      await events(
        await call({
          action: 'edit',
          project: weatherEsp32,
          language: 'arduino',
          code,
          instruction: 'добавь зуммер',
        }),
      )
    ).at(-1) as Extract<CodeEvent, { type: 'done' }>;
    expect(edit.result.code).toContain('[demo] добавь зуммер');
    const ex = (
      await events(
        await call({ action: 'explain', project: weatherEsp32, language: 'arduino', code }),
      )
    ).at(-1) as Extract<CodeEvent, { type: 'done' }>;
    expect(ex.result.explanation).toContain('объяснение');
  });

  it('validates the request', async () => {
    expect((await call('not json')).status).toBe(400);
    expect(
      (await call({ action: 'generate', project: { title: 'x' }, language: 'arduino' })).status,
    ).toBe(400);
    expect(
      (await call({ action: 'delete', project: weatherEsp32, language: 'arduino' })).status,
    ).toBe(400);
    const lang = await call({ action: 'generate', project: blinkUno, language: 'micropython' });
    expect(lang.status).toBe(400);
    expect(await lang.json()).toMatchObject({
      error: 'unsupported_language',
      supported: ['arduino'],
    });
    expect(
      (
        await call({
          action: 'generate',
          project: { ...weatherEsp32, boardId: 'nope' },
          language: 'arduino',
        })
      ).status,
    ).toBe(400);
    expect((await call(' '.repeat(500_000))).status).toBe(413);
  });

  it('rate limits per address', async () => {
    for (let i = 0; i < 20; i++) expect((await call('x', '7.7.7.7')).status).toBe(400);
    expect((await call('x', '7.7.7.7')).status).toBe(429);
  });
});
