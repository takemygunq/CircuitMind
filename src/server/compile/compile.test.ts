import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { DockerCompileRunner, dockerArgs } from './docker';
import { FQBN_BY_BOARD, fqbnFor, supportedFqbns } from './fqbn';
import { parseDiagnostics, parseSizes } from './parse';
import { CompileBusyError, CompileService, CompilerUnavailableError } from './service';
import type { CompileResult, CompileRunner } from './types';

const LOG_OK = `Sketch uses 1958 bytes (6%) of program storage space. Maximum is 32256 bytes.
Global variables use 192 bytes (9%) of dynamic memory, leaving 1856 bytes for local variables. Maximum is 2048 bytes.`;

describe('parseDiagnostics', () => {
  const log = `/tmp/cm-ab12/sketch/sketch.ino:7:3: error: 'foo' was not declared in this scope
   foo();
   ^~~
sketch.ino:12: warning: unused variable 'x'
/opt/arduino/user/libraries/DHT/DHT.cpp:44:1: error: not ours
fatal: nothing
/tmp/cm-ab12/sketch/sketch.ino:20:1: fatal error: Missing.h: No such file or directory`;
  it('keeps only sketch diagnostics with line, column and severity', () => {
    expect(parseDiagnostics(log)).toEqual([
      { severity: 'error', line: 7, column: 3, message: "'foo' was not declared in this scope" },
      { severity: 'warning', line: 12, message: "unused variable 'x'" },
      { severity: 'error', line: 20, column: 1, message: 'Missing.h: No such file or directory' },
    ]);
  });
  it('caps the list and tolerates empty input', () => {
    expect(parseDiagnostics('')).toEqual([]);
    expect(
      parseDiagnostics(
        Array.from({ length: 100 }, (_, i) => `sketch.ino:${i + 1}:1: error: e`).join('\n'),
      ),
    ).toHaveLength(50);
  });
});

describe('parseSizes', () => {
  it('reads flash and RAM usage', () => {
    expect(parseSizes(LOG_OK)).toEqual({
      flashUsed: 1958,
      flashMax: 32256,
      ramUsed: 192,
      ramMax: 2048,
    });
  });
  it('handles flash-only logs and failures', () => {
    expect(
      parseSizes('Sketch uses 10 bytes (1%) of program storage space. Maximum is 100 bytes.'),
    ).toEqual({ flashUsed: 10, flashMax: 100 });
    expect(parseSizes('error')).toBeUndefined();
  });
});

describe('fqbn', () => {
  it('maps library boards and honours the image configuration', () => {
    expect(FQBN_BY_BOARD['arduino-uno']).toBe('arduino:avr:uno');
    expect(fqbnFor('arduino-uno', {})).toBe('arduino:avr:uno');
    expect(fqbnFor('arduino-nano', {})).toBe('arduino:avr:nano:cpu=atmega328');
    expect(fqbnFor('esp32-devkit-v1', {})).toBeUndefined(); // ядра ESP32 нет в образе по умолчанию
    expect(
      fqbnFor('esp32-devkit-v1', { COMPILER_FQBNS: 'arduino:avr:uno, esp32:esp32:esp32' }),
    ).toBe('esp32:esp32:esp32');
    expect(fqbnFor('unknown', {})).toBeUndefined();
    expect(supportedFqbns({ COMPILER_FQBNS: '' })).toEqual([]);
  });
});

describe('dockerArgs (sandbox)', () => {
  const args = dockerArgs({ image: 'img', name: 'n1' });
  const after = (flag: string) => args[args.indexOf(flag) + 1];
  it('isolates the compiler: no network, read-only root, no capabilities, non-root', () => {
    expect(after('--network')).toBe('none');
    expect(args).toContain('--read-only');
    expect(after('--cap-drop')).toBe('ALL');
    expect(after('--security-opt')).toBe('no-new-privileges');
    expect(after('--user')).toBe('10001:10001');
    expect(after('--tmpfs')).toMatch(/noexec,nosuid,nodev/);
  });
  it('limits resources and removes the container', () => {
    expect(after('--memory')).toBe('1g');
    expect(after('--memory-swap')).toBe('1g'); // без swap сверх лимита
    expect(after('--cpus')).toBe('2');
    expect(Number(after('--pids-limit'))).toBeLessThanOrEqual(256);
    expect(args).toContain('--rm');
    expect(args.at(-1)).toBe('img');
  });
  it('never mounts host paths or enables privileged mode', () => {
    expect(args).not.toContain('-v');
    expect(args).not.toContain('--volume');
    expect(args).not.toContain('--privileged');
    expect(args.join(' ')).not.toMatch(/--network host|--pid( |=)|--ipc|--uts/);
  });
});

describe('DockerCompileRunner with a fake docker', () => {
  function fakeDocker(
    reply: (args: string[], input: string) => { stdout?: string; code?: number; hang?: boolean },
  ) {
    const calls: { args: string[]; input: string }[] = [];
    const spawnDocker = ((_cmd: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { end(s?: string): void; on(): void };
        kill(): void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      let input = '';
      child.stdin = {
        on() {},
        end(s = '') {
          input = s;
          calls.push({ args, input });
          const r = reply(args, input);
          if (r.hang) return;
          setImmediate(() => {
            if (r.stdout) child.stdout.emit('data', Buffer.from(r.stdout));
            child.emit('close', r.code ?? 0);
          });
        },
      };
      child.kill = () => setImmediate(() => child.emit('close', null));
      return child;
    }) as never;
    return { runner: new DockerCompileRunner({ spawnDocker, image: 'img' }), calls };
  }
  const ok = {
    ok: true,
    log: LOG_OK,
    files: { 'sketch.ino.hex': Buffer.from(':00000001FF\n').toString('base64'), 'x.uf2': 'QUJD' },
  };

  it('sends the sketch on stdin and parses the compiler JSON', async () => {
    const { runner, calls } = fakeDocker(() => ({ stdout: JSON.stringify(ok) }));
    const r = await runner.run({ fqbn: 'arduino:avr:uno', code: 'void setup(){}' }, 60_000);
    expect(JSON.parse(calls[0].input)).toMatchObject({
      fqbn: 'arduino:avr:uno',
      code: 'void setup(){}',
      timeout: 55,
    });
    expect(r).toMatchObject({
      ok: true,
      hex: ':00000001FF\n',
      files: { 'x.uf2': 'QUJD' },
      sizes: { flashUsed: 1958 },
    });
  });
  it('reports compile errors with diagnostics', async () => {
    const log = "sketch.ino:3:1: error: 'x' was not declared in this scope";
    const { runner } = fakeDocker(() => ({
      stdout: JSON.stringify({ ok: false, log, files: {} }),
    }));
    const r = await runner.run({ fqbn: 'f', code: 'c' }, 60_000);
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toEqual([
      { severity: 'error', line: 3, column: 1, message: "'x' was not declared in this scope" },
    ]);
    expect(r.hex).toBeUndefined();
  });
  it('kills a hung compilation and returns a timeout', async () => {
    const { runner, calls } = fakeDocker(() => ({ hang: true }));
    const r = await runner.run({ fqbn: 'f', code: 'c' }, 30);
    expect(r).toMatchObject({ ok: false, timedOut: true });
    await new Promise((res) => setTimeout(res, 20));
    expect(calls.some((c) => c.args[0] === 'kill')).toBe(true);
  });
  it('turns garbage output into an environment error', async () => {
    const { runner } = fakeDocker(() => ({ stdout: 'not json', code: 125 }));
    const r = await runner.run({ fqbn: 'f', code: 'c' }, 1000);
    expect(r.ok).toBe(false);
    expect(r.log).toContain('Compiler failed to run');
  });
  it('checks image availability and caches the answer', async () => {
    let inspects = 0;
    const { runner } = fakeDocker((args) => (args[0] === 'image' ? (inspects++, { code: 0 }) : {}));
    expect(await runner.available()).toBe(true);
    expect(await runner.available()).toBe(true);
    expect(inspects).toBe(1);
    expect(
      await new DockerCompileRunner({
        spawnDocker: fakeDocker(() => ({ code: 1 })).runner['spawnFn'] as never,
      }).available(),
    ).toBe(false);
  });
});

describe('CompileService', () => {
  const result = (over: Partial<CompileResult> = {}): CompileResult => ({
    ok: true,
    log: LOG_OK,
    diagnostics: [],
    files: {},
    hex: ':00',
    durationMs: 5,
    ...over,
  });
  const runner = (r: CompileResult, available = true, delay = 0) => {
    const calls: string[] = [];
    const impl: CompileRunner = {
      available: async () => available,
      run: async (req) => {
        calls.push(req.code);
        if (delay) await new Promise((res) => setTimeout(res, delay));
        return r;
      },
    };
    return { impl, calls };
  };

  it('caches by fqbn and code', async () => {
    const { impl, calls } = runner(result());
    const svc = new CompileService({ runner: impl });
    await svc.compile({ fqbn: 'a', code: 'x' });
    expect((await svc.compile({ fqbn: 'a', code: 'x' })).cached).toBe(true);
    await svc.compile({ fqbn: 'b', code: 'x' });
    expect(calls).toHaveLength(2);
  });
  it('does not cache timeouts or environment failures, but caches real compile errors', async () => {
    const t = runner(result({ ok: false, timedOut: true }));
    const svc = new CompileService({ runner: t.impl });
    await svc.compile({ fqbn: 'a', code: 'x' });
    await svc.compile({ fqbn: 'a', code: 'x' });
    expect(t.calls).toHaveLength(2);
    const e = runner(
      result({ ok: false, diagnostics: [{ severity: 'error', line: 1, message: 'm' }] }),
    );
    const svc2 = new CompileService({ runner: e.impl });
    await svc2.compile({ fqbn: 'a', code: 'y' });
    await svc2.compile({ fqbn: 'a', code: 'y' });
    expect(e.calls).toHaveLength(1);
  });
  it('requires the image and limits concurrency', async () => {
    await expect(
      new CompileService({ runner: runner(result(), false).impl }).compile({
        fqbn: 'a',
        code: 'x',
      }),
    ).rejects.toBeInstanceOf(CompilerUnavailableError);
    const slow = runner(result(), true, 30);
    const svc = new CompileService({ runner: slow.impl, maxConcurrent: 1 });
    const first = svc.compile({ fqbn: 'a', code: '1' });
    await new Promise((r) => setTimeout(r, 5));
    await expect(svc.compile({ fqbn: 'a', code: '2' })).rejects.toBeInstanceOf(CompileBusyError);
    await first;
    await expect(svc.compile({ fqbn: 'a', code: '2' })).resolves.toMatchObject({ ok: true });
  });
});

// ───────── интеграция с настоящим Docker (пропускается, если образа нет) ─────────
const hasImage =
  spawnSync('docker', ['image', 'inspect', 'circuitmind-compiler'], { stdio: 'ignore' }).status ===
  0;
describe.skipIf(!hasImage)('real sandbox (docker image circuitmind-compiler)', () => {
  const runner = new DockerCompileRunner();
  it('compiles an Arduino Uno sketch to HEX', async () => {
    const r = await runner.run(
      {
        fqbn: 'arduino:avr:uno',
        code: 'void setup(){pinMode(13,OUTPUT);}\nvoid loop(){digitalWrite(13,HIGH);}\n',
      },
      120_000,
    );
    expect(r.ok, r.log).toBe(true);
    expect(r.hex).toMatch(/^:[0-9A-F]+/);
    expect(r.hex!.trimEnd().endsWith(':00000001FF')).toBe(true);
    expect(r.sizes!.flashMax).toBe(32256);
  }, 150_000);
  it('compiles a sketch that uses an installed library', async () => {
    const code =
      '#include <DHT.h>\nDHT dht(2, DHT22);\nvoid setup(){dht.begin();}\nvoid loop(){dht.readTemperature();}\n';
    expect((await runner.run({ fqbn: 'arduino:avr:uno', code }, 120_000)).ok).toBe(true);
  }, 150_000);
  it('reports errors with the right line numbers', async () => {
    const r = await runner.run(
      {
        fqbn: 'arduino:avr:uno',
        code: 'void setup(){}\nvoid loop(){\n  undefinedFunction();\n}\n',
      },
      120_000,
    );
    expect(r.ok).toBe(false);
    expect(r.hex).toBeUndefined();
    expect(r.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        line: 3,
        message: expect.stringContaining('undefinedFunction'),
      }),
    ]);
  }, 150_000);
  it('has no network access inside the sandbox', () => {
    const r = spawnSync(
      'docker',
      [
        ...dockerArgs({ image: 'circuitmind-compiler', name: 'cm-nettest' }).slice(0, -1),
        '--entrypoint',
        'python3',
        'circuitmind-compiler',
        '-c',
        "import socket; socket.create_connection(('1.1.1.1',53),timeout=3)",
      ],
      { encoding: 'utf8' },
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unreachable|refused|timed out|Errno/);
  }, 30_000);
  it('cannot write outside /tmp (read-only root)', () => {
    const r = spawnSync(
      'docker',
      [
        ...dockerArgs({ image: 'circuitmind-compiler', name: 'cm-rotest' }).slice(0, -1),
        '--entrypoint',
        'python3',
        'circuitmind-compiler',
        '-c',
        "open('/etc/pwned','w').write('x')",
      ],
      { encoding: 'utf8' },
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Read-only|Permission denied/);
  }, 30_000);
});
