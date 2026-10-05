import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelClient } from '../agent/model-client';
import { makeMessage, textBlock } from './message';
import { envelopeSchema, parseEnvelope, renderToolPrompt, renderTranscript } from './text-tools';
import {
  ProviderError,
  type ModelEntry,
  type ProviderAdapter,
  type ProviderConfig,
  type ProviderKind,
} from './types';

/**
 * CLI-мосты: Claude Code, Codex и Gemini CLI вызываются как подпроцессы в неинтерактивном режиме —
 * можно пользоваться подпиской, залогинившись в CLI через браузер. У CLI нет tool use, поэтому вызовы
 * инструментов эмулируются JSON-ответом (text-tools.ts). Программа запускается без инструментов,
 * в пустом каталоге и без сохранения сессий.
 */

const TIMEOUT_MS = 6 * 60_000;
const MAX_OUTPUT = 32 * 1024 * 1024;

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}
export class CliMissingError extends ProviderError {}

/** Запуск CLI: stdin → stdout, с таймаутом и отменой. Нет программы → CliMissingError. */
export function runCli(
  command: string,
  args: string[],
  opts: { input?: string; cwd?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs ?? TIMEOUT_MS);
    const onAbort = () => child.kill('SIGTERM');
    opts.signal?.addEventListener('abort', onAbort);
    const collect = (append: (s: string) => void) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) child.kill('SIGTERM');
      else append(chunk.toString('utf8'));
    };
    child.stdout.on(
      'data',
      collect((s) => (stdout += s)),
    );
    child.stderr.on(
      'data',
      collect((s) => (stderr += s)),
    );
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        e.code === 'ENOENT' ? new CliMissingError(`Program "${command}" not found`, false) : e,
      );
    });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) {
        reject(opts.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }
      if (sig) {
        reject(new ProviderError(`${command} did not answer in time`, true));
        return;
      }
      resolve({ stdout, stderr, code });
    });
    child.stdin.on('error', () => {}); // процесс мог завершиться раньше, чем мы дописали stdin
    child.stdin.end(opts.input ?? '');
  });
}

/** Пустой рабочий каталог: агенту в CLI нечего читать и негде что-то сломать. */
function sandboxDir(): string {
  const dir = path.join(os.tmpdir(), 'circuitmind-cli-sandbox');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface CliAsk {
  system: string;
  prompt: string;
  /** JSON Schema ответа. */
  schema?: object;
  signal?: AbortSignal;
}
interface CliAnswer {
  text: string;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
}

/** Системный промпт, задание и формат ответа — одним текстом (у Codex и Gemini CLI нет отдельного system). */
export function renderCliPrompt(
  req: CliAsk,
  opts: { includeSystem: boolean; includeSchema: boolean },
): string {
  const parts: string[] = [];
  if (opts.includeSystem && req.system.trim()) parts.push('# Instructions', req.system, '');
  parts.push('# Task', req.prompt, '');
  if (opts.includeSchema && req.schema)
    parts.push(
      '# Answer format',
      'Answer with ONE JSON object only, no explanations and no ``` fences, strictly following this JSON Schema:',
      JSON.stringify(req.schema),
    );
  return parts.join('\n');
}

const modelsConfig = (): Record<string, ModelEntry[]> => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'config', 'cli-models.json'), 'utf8'),
    );
  } catch {
    return {};
  }
};

interface CliSpec {
  kind: ProviderKind;
  title: string;
  command: string;
  install: string;
  login: string;
  /** Проверка входа: null — всё хорошо, иначе текст проблемы. */
  checkLogin(command: string): Promise<string | null>;
  ask(command: string, model: string, req: CliAsk): Promise<CliAnswer>;
}

const looksUnauthorized = (text: string) =>
  /log ?in|logged|auth|unauthori[sz]ed|401|credential|api key/i.test(text);

function failure(title: string, text: string, login: string): ProviderError {
  const clean = text.trim().slice(0, 500) || 'no message';
  return looksUnauthorized(clean)
    ? new ProviderError(
        `${title}: login required (${clean}). Run in a terminal: ${login}`,
        false,
        401,
      )
    : new ProviderError(`${title}: ${clean}`, /rate|limit|overload|timeout|503|529/i.test(clean));
}

function createCliAdapter(spec: CliSpec): ProviderAdapter {
  const command = (c: ProviderConfig) => c.baseUrl?.trim() || spec.command;
  const notInstalled = () =>
    `${spec.title} is not installed. Install: ${spec.install}. Then log in: ${spec.login}`;

  async function healthCheck(config: ProviderConfig) {
    try {
      const v = await runCli(command(config), ['--version'], { timeoutMs: 30_000 });
      if (v.code !== 0)
        return {
          ok: false,
          error: `${spec.title} does not start: ${(v.stderr || v.stdout).trim().slice(0, 300)}`,
        };
      const problem = await spec.checkLogin(command(config));
      return problem
        ? {
            ok: false,
            error: `${problem} Log in via the browser — run in a terminal: ${spec.login}`,
          }
        : { ok: true };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof CliMissingError
            ? notInstalled()
            : e instanceof Error
              ? e.message
              : String(e),
      };
    }
  }

  const ask = async (config: ProviderConfig, model: string, req: CliAsk) => {
    try {
      return await spec.ask(command(config), model, req);
    } catch (e) {
      if (e instanceof CliMissingError) throw new ProviderError(notInstalled(), false);
      throw e;
    }
  };

  return {
    kind: spec.kind,
    title: spec.title,
    createModel(config, modelId) {
      const label = `${spec.kind}:${modelId}`;
      const client: ModelClient = {
        model: label,
        async turn({ system, tools, messages, signal, onText }) {
          if (tools.length === 0) {
            // без инструментов (объяснение кода): обычный текстовый ответ, без JSON-обёртки
            const answer = await ask(config, modelId, {
              system,
              prompt: renderTranscript(messages),
              signal,
            });
            const text = answer.text.trim();
            if (text) onText?.(text);
            return makeMessage(label, text ? [textBlock(text)] : [], 'end_turn', answer.usage);
          }
          const p = renderToolPrompt({ system, tools, messages });
          const answer = await ask(config, modelId, {
            ...p,
            schema: envelopeSchema(tools),
            signal,
          });
          const msg = parseEnvelope(answer.text, label, answer.usage);
          const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
          if (text) onText?.(text);
          return msg;
        },
      };
      return {
        client,
        async askJson({ system, prompt, schema, signal }) {
          return (await ask(config, modelId, { system, prompt, schema, signal })).text;
        },
      };
    },
    healthCheck,
    async listModels() {
      return modelsConfig()[spec.kind] ?? [{ id: 'default', label: 'Default model of the CLI' }];
    },
  };
}

/* ---------------- Claude Code ---------------- */

export interface ClaudeResult {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export function parseClaudeOutput(stdout: string): ClaudeResult {
  const line = stdout
    .trim()
    .split('\n')
    .reverse()
    .find((l) => l.trim().startsWith('{'));
  if (!line)
    throw new ProviderError(
      `Claude Code returned an unexpected answer: ${stdout.slice(0, 300)}`,
      false,
    );
  return JSON.parse(line) as ClaudeResult;
}

export const claudeCliAdapter = createCliAdapter({
  kind: 'claude-cli',
  title: 'Claude Code CLI',
  command: 'claude',
  install: 'npm install -g @anthropic-ai/claude-code',
  login: 'claude auth login',
  async checkLogin(command) {
    const r = await runCli(command, ['auth', 'status', '--json'], { timeoutMs: 30_000 });
    try {
      return (JSON.parse(r.stdout) as { loggedIn?: boolean }).loggedIn
        ? null
        : 'Claude Code is not logged in.';
    } catch {
      return r.code === 0 ? null : 'Could not check the Claude Code login.';
    }
  },
  async ask(command, model, req) {
    const args = [
      '-p',
      '--output-format',
      'json',
      // без инструментов, настроек, MCP и сохранения сессий: чистый вызов модели
      '--tools',
      '',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--system-prompt',
      req.system,
    ];
    if (model !== 'default') args.push('--model', model);
    if (req.schema) args.push('--json-schema', JSON.stringify(req.schema));
    const r = await runCli(command, args, {
      input: req.prompt,
      cwd: sandboxDir(),
      signal: req.signal,
    });
    let out: ClaudeResult;
    try {
      out = parseClaudeOutput(r.stdout);
    } catch {
      throw failure('Claude Code', r.stderr || r.stdout, 'claude auth login');
    }
    if (out.is_error) throw failure('Claude Code', out.result ?? r.stderr, 'claude auth login');
    const u = out.usage;
    return {
      text:
        out.structured_output !== undefined && out.structured_output !== null
          ? JSON.stringify(out.structured_output)
          : (out.result ?? ''),
      usage: {
        inputTokens:
          (u?.input_tokens ?? 0) +
          (u?.cache_read_input_tokens ?? 0) +
          (u?.cache_creation_input_tokens ?? 0),
        outputTokens: u?.output_tokens ?? 0,
        cachedInputTokens: u?.cache_read_input_tokens ?? 0,
      },
    };
  },
});

/* ---------------- Codex CLI ---------------- */

function findKey(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  if (key in obj) return (obj as Record<string, unknown>)[key];
  for (const v of Object.values(obj)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** Токены из JSONL-событий Codex (`--json`): берём последнее событие с usage. */
export function parseCodexUsage(stdout: string): CliAnswer['usage'] {
  let found: CliAnswer['usage'] = { inputTokens: 0, outputTokens: 0 };
  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const u = findKey(JSON.parse(line), 'usage') as
        { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number } | undefined;
      if (u && typeof u.input_tokens === 'number')
        found = {
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens ?? 0,
          cachedInputTokens: u.cached_input_tokens ?? 0,
        };
    } catch {
      /* не JSON — пропускаем */
    }
  }
  return found;
}

export const codexCliAdapter = createCliAdapter({
  kind: 'codex-cli',
  title: 'Codex CLI',
  command: 'codex',
  install: 'npm install -g @openai/codex',
  login: 'codex login',
  async checkLogin(command) {
    const r = await runCli(command, ['login', 'status'], { timeoutMs: 30_000 });
    return /not logged in/i.test(`${r.stdout}\n${r.stderr}`) || r.code !== 0
      ? 'Codex is not logged in.'
      : null;
  },
  async ask(command, model, req) {
    const dir = sandboxDir();
    const outFile = path.join(dir, `codex-${crypto.randomUUID()}.txt`);
    try {
      const args = [
        'exec',
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox',
        'read-only',
        '--color',
        'never',
        '--json',
        '-C',
        dir,
        '-o',
        outFile,
      ];
      if (model !== 'default') args.push('-m', model);
      args.push('-'); // промпт — из stdin
      const r = await runCli(command, args, {
        input: renderCliPrompt(req, { includeSystem: true, includeSchema: true }),
        cwd: dir,
        signal: req.signal,
      });
      const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
      if (r.code !== 0 || !text.trim()) throw failure('Codex', r.stderr || r.stdout, 'codex login');
      return { text, usage: parseCodexUsage(r.stdout) };
    } finally {
      fs.rmSync(outFile, { force: true });
    }
  },
});

/* ---------------- Gemini CLI ---------------- */

export interface GeminiCliResult {
  response?: string;
  error?: { message?: string };
  stats?: {
    models?: Record<string, { tokens?: { prompt?: number; candidates?: number; cached?: number } }>;
  };
}

export function parseGeminiOutput(stdout: string): GeminiCliResult {
  const start = stdout.indexOf('{');
  if (start < 0)
    throw new ProviderError(
      `Gemini CLI returned an unexpected answer: ${stdout.slice(0, 300)}`,
      false,
    );
  return JSON.parse(stdout.slice(start)) as GeminiCliResult;
}

export const geminiCliAdapter = createCliAdapter({
  kind: 'gemini-cli',
  title: 'Gemini CLI',
  command: 'gemini',
  install: 'npm install -g @google/gemini-cli',
  login: 'gemini (choose "Login with Google")',
  async checkLogin() {
    // у Gemini CLI нет команды статуса: вход — это сохранённые OAuth-данные или ключ в окружении
    return fs.existsSync(path.join(os.homedir(), '.gemini', 'oauth_creds.json')) ||
      process.env.GEMINI_API_KEY
      ? null
      : 'Gemini CLI is not logged in.';
  },
  async ask(command, model, req) {
    const args = ['-p', 'Do the task described above.', '-o', 'json', '--approval-mode', 'plan'];
    if (model !== 'default') args.push('-m', model);
    const r = await runCli(command, args, {
      input: renderCliPrompt(req, { includeSystem: true, includeSchema: true }),
      cwd: sandboxDir(),
      signal: req.signal,
    });
    let out: GeminiCliResult;
    try {
      out = parseGeminiOutput(r.stdout);
    } catch {
      throw failure('Gemini CLI', r.stderr || r.stdout, 'gemini');
    }
    if (out.error?.message || r.code !== 0)
      throw failure('Gemini CLI', out.error?.message ?? r.stderr, 'gemini');
    const usage = Object.values(out.stats?.models ?? {}).reduce(
      (acc, m) => ({
        inputTokens: acc.inputTokens + (m.tokens?.prompt ?? 0),
        outputTokens: acc.outputTokens + (m.tokens?.candidates ?? 0),
        cachedInputTokens: acc.cachedInputTokens + (m.tokens?.cached ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    );
    return { text: out.response ?? '', usage };
  },
});
