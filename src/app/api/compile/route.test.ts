import { beforeEach, describe, expect, it } from 'vitest';
import { setCompileService } from '@/server/compile/instance';
import { CompileService } from '@/server/compile/service';
import type { CompileResult, CompileRunner } from '@/server/compile/types';
import { GET, POST, compileLimiter } from './route';

const okResult: CompileResult = {
  ok: true,
  log: 'Sketch uses 1958 bytes (6%) of program storage space. Maximum is 32256 bytes.',
  diagnostics: [],
  files: {},
  hex: ':00000001FF\n',
  durationMs: 12,
  sizes: { flashUsed: 1958, flashMax: 32256 },
};
const runner = (over: Partial<CompileRunner> = {}): CompileRunner => ({
  available: async () => true,
  run: async () => okResult,
  ...over,
});
const post = (body: unknown, ip = '3.3.3.3') =>
  POST(
    new Request('http://localhost/api/compile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }),
  );
const code = 'void setup(){}\nvoid loop(){}\n';

describe('/api/compile', () => {
  beforeEach(() => {
    compileLimiter.reset();
    setCompileService(new CompileService({ runner: runner() }));
  });

  it('GET reports availability and compilable boards', async () => {
    expect(await (await GET()).json()).toMatchObject({
      available: true,
      boards: ['arduino-uno', 'arduino-nano'],
    });
    setCompileService(new CompileService({ runner: runner({ available: async () => false }) }));
    expect(await (await GET()).json()).toMatchObject({ available: false, boards: [] });
  });

  it('POST compiles for a supported board', async () => {
    const res = await post({ code, boardId: 'arduino-uno' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      hex: ':00000001FF\n',
      sizes: { flashUsed: 1958 },
    });
  });

  it('passes the right FQBN to the runner', async () => {
    const seen: string[] = [];
    setCompileService(
      new CompileService({ runner: runner({ run: async (r) => (seen.push(r.fqbn), okResult) }) }),
    );
    await post({ code, boardId: 'arduino-nano' });
    expect(seen).toEqual(['arduino:avr:nano:cpu=atmega328']);
  });

  it('rejects invalid input and boards without a toolchain', async () => {
    expect((await post({ code: 'x', boardId: 'arduino-uno' })).status).toBe(400);
    expect((await post({ boardId: 'arduino-uno' })).status).toBe(400);
    expect((await post({ code: 'x'.repeat(70_000), boardId: 'arduino-uno' })).status).toBe(400);
    const res = await post({ code, boardId: 'esp32-devkit-v1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'compile_unsupported' });
  });

  it('answers 503 when the compiler is unavailable and 429 when rate limited', async () => {
    setCompileService(new CompileService({ runner: runner({ available: async () => false }) }));
    const res = await post({ code, boardId: 'arduino-uno' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'compiler_unavailable' });
    for (let i = 0; i < 10; i++) await post({ code, boardId: 'arduino-uno' }, '4.4.4.4');
    expect((await post({ code, boardId: 'arduino-uno' }, '4.4.4.4')).status).toBe(429);
  });
});
