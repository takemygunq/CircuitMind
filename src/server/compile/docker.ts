import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { parseDiagnostics, parseSizes } from './parse';
import type { CompileResult, CompileRunner } from './types';

export interface SandboxOptions {
  image: string;
  name: string;
  memory?: string;
  cpus?: string;
  pids?: number;
  tmpfsSize?: string;
}

/**
 * Аргументы `docker run` для песочницы: без сети, корень только для чтения, tmpfs без исполнения,
 * без capabilities и повышения привилегий, лимиты памяти/CPU/процессов, непривилегированный пользователь.
 */
export function dockerArgs(o: SandboxOptions): string[] {
  return [
    'run',
    '--rm',
    '-i',
    '--name',
    o.name,
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    `/tmp:rw,noexec,nosuid,nodev,size=${o.tmpfsSize ?? '512m'}`,
    '--memory',
    o.memory ?? '1g',
    '--memory-swap',
    o.memory ?? '1g',
    '--cpus',
    o.cpus ?? '2',
    '--pids-limit',
    String(o.pids ?? 256),
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '10001:10001',
    o.image,
  ];
}

const MAX_STDOUT = 8_000_000;

interface RunDeps {
  /** Запуск docker (подменяется в тестах). */
  spawnDocker?: typeof spawn;
  image?: string;
}

function exec(
  spawnFn: typeof spawn,
  args: string[],
  input: string | undefined,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawnFn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < MAX_STDOUT) stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 100_000) stderr += d.toString('utf8');
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });
}

/** Компиляция в одноразовом Docker-контейнере. Исходник передаётся через stdin, результат — JSON из stdout. */
export class DockerCompileRunner implements CompileRunner {
  private readonly spawnFn: typeof spawn;
  private readonly image: string;
  private availableAt = 0;
  private availableValue = false;

  constructor(deps: RunDeps = {}) {
    this.spawnFn = deps.spawnDocker ?? spawn;
    this.image = deps.image ?? process.env.COMPILER_IMAGE ?? 'circuitmind-compiler';
  }

  async available(): Promise<boolean> {
    if (Date.now() - this.availableAt < 30_000) return this.availableValue;
    const r = await exec(this.spawnFn, ['image', 'inspect', this.image], undefined, 5_000);
    this.availableAt = Date.now();
    this.availableValue = r.code === 0;
    return this.availableValue;
  }

  async run(req: Parameters<CompileRunner['run']>[0], timeoutMs: number): Promise<CompileResult> {
    const name = `cm-compile-${randomBytes(6).toString('hex')}`;
    const started = Date.now();
    const input = JSON.stringify({
      fqbn: req.fqbn,
      code: req.code,
      timeout: Math.floor(timeoutMs / 1000) - 5,
    });
    const r = await exec(this.spawnFn, dockerArgs({ image: this.image, name }), input, timeoutMs);
    if (r.timedOut) {
      // Принудительно останавливаем контейнер, если процесс docker убит, а контейнер ещё жив
      void exec(this.spawnFn, ['kill', name], undefined, 5_000);
      return {
        ok: false,
        log: 'Compilation timed out',
        diagnostics: [],
        files: {},
        durationMs: Date.now() - started,
        timedOut: true,
      };
    }
    let parsed:
      { ok?: boolean; log?: string; files?: Record<string, string>; timeout?: boolean } | undefined;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      /* ниже вернём ошибку окружения */
    }
    if (!parsed)
      return {
        ok: false,
        log: `Compiler failed to run (exit ${r.code}): ${r.stderr.slice(-2000)}`,
        diagnostics: [],
        files: {},
        durationMs: Date.now() - started,
      };

    const { 'sketch.ino.hex': hexB64, ...files } = parsed.files ?? {};
    const log = parsed.log ?? '';
    return {
      ok: !!parsed.ok,
      log,
      diagnostics: parseDiagnostics(log),
      ...(hexB64 && { hex: Buffer.from(hexB64, 'base64').toString('ascii') }),
      files,
      sizes: parseSizes(log),
      durationMs: Date.now() - started,
      ...(parsed.timeout && { timedOut: true }),
    };
  }
}
