import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  MAX_FIRMWARE_CHARS,
  PIN_BLOCK_END,
  PIN_BLOCK_START,
  buildPinBindings,
  buildPreamble,
  composeFirmware,
  describeIssue,
  lintFirmware,
} from '@/core/code';
import type { BoardDef, Language, Project } from '@/core/schema';
import type { Locale } from '@/i18n';
import { AgentError, type AgentUsage } from '../agent/events';
import { abortable } from '../agent/abortable';
import type { ModelClient } from '../agent/model-client';
import type { CodeEvent, CodeMode, CodeResult, LintMessage } from './events';
import {
  EXPLAIN_SYSTEM_PROMPT,
  FIRMWARE_SYSTEM_PROMPT,
  editUserMessage,
  explainUserMessage,
  generateUserMessage,
} from './prompt';

export interface CodeRequest {
  mode: CodeMode;
  project: Project;
  board: BoardDef;
  language: Language;
  locale: Locale;
  /** Текущий файл целиком (edit / explain). */
  code?: string;
  instruction?: string;
}

export interface RunCodeOptions {
  client: ModelClient;
  request: CodeRequest;
  emit: (e: CodeEvent) => void;
  signal?: AbortSignal;
  maxRepairs?: number;
  maxOutputTokens?: number;
}

const SubmitInput = z.object({
  body: z.string().min(1).max(MAX_FIRMWARE_CHARS),
  explanation: z.string().default(''),
  libraries: z.array(z.string()).default([]),
});

const SUBMIT_TOOL: Anthropic.Tool = {
  name: 'submit_firmware',
  description:
    'Submit the firmware body (everything after the generated pin block), a short explanation for a beginner and the list of libraries to install. Call it once; call it again with the full corrected body if the checker reports problems.',
  input_schema: {
    type: 'object',
    properties: {
      body: { type: 'string', description: 'Complete code after the pin block' },
      explanation: { type: 'string', description: 'How the program works / what changed' },
      libraries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Libraries the user must install',
      },
    },
    required: ['body', 'explanation', 'libraries'],
    additionalProperties: false,
  },
  strict: true,
  eager_input_streaming: true,
} as Anthropic.Tool;

/** Делит файл на тело и блок пинов (если блок на месте). */
export function splitFirmware(code: string): { body: string; hasBlock: boolean } {
  const lines = code.split('\n');
  const start = lines.findIndex((l) => l.includes(PIN_BLOCK_START));
  const end = lines.findIndex((l, i) => i >= start && start >= 0 && l.includes(PIN_BLOCK_END));
  if (start < 0 || end < 0) return { body: code, hasBlock: false };
  return {
    body: [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n').replace(/^\s*\n/, ''),
    hasBlock: true,
  };
}

const toMessages = (issues: ReturnType<typeof lintFirmware>): LintMessage[] =>
  issues.map((i) => ({
    severity: i.severity,
    code: i.code,
    ...(i.line !== undefined && { line: i.line }),
    message: describeIssue(i),
    params: i.params,
  }));

/**
 * Генерация и правка прошивки. Блок пинов строится детерминированно и всегда ставится первым;
 * модель пишет только тело. Результат проходит линтер, ошибки возвращаются модели (до maxRepairs раз).
 */
export async function runCodeAgent(opts: RunCodeOptions): Promise<CodeResult> {
  const { client, request, emit, signal, maxRepairs = 2, maxOutputTokens = 60_000 } = opts;
  const { project, board, language, locale } = request;
  const bindings = buildPinBindings(project, board);
  const preamble = buildPreamble(bindings, language, board);
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const track = (m: Anthropic.Message) => {
    usage.inputTokens += m.usage.input_tokens;
    usage.outputTokens += m.usage.output_tokens;
    usage.cacheReadTokens += m.usage.cache_read_input_tokens ?? 0;
    if (m.stop_reason === 'refusal')
      throw new AgentError('refused', 'The model declined this request');
    if (usage.outputTokens > maxOutputTokens)
      throw new AgentError('budget_exceeded', `Output token budget exceeded (${maxOutputTokens})`);
  };
  const base = { mode: request.mode, language, usage, model: client.model };
  emit({ type: 'start', mode: request.mode, model: client.model });

  if (request.mode === 'explain') {
    if (!request.code?.trim()) throw new AgentError('invalid_request', 'Nothing to explain');
    const msg = await abortable(
      client.turn({
        system: EXPLAIN_SYSTEM_PROMPT,
        tools: [],
        messages: [
          {
            role: 'user',
            content: explainUserMessage({
              project,
              bindings,
              language,
              locale,
              code: request.code,
              question: request.instruction,
            }),
          },
        ],
        signal,
        onText: (delta) => emit({ type: 'text', delta }),
      }),
      signal,
    );
    track(msg);
    const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return {
      ...base,
      code: '',
      explanation: text.trim(),
      libraries: [],
      issues: [],
      ok: true,
      attempts: 1,
    };
  }

  const current = request.code ? splitFirmware(request.code).body : '';
  if (request.mode === 'edit' && (!current.trim() || !request.instruction?.trim()))
    throw new AgentError('invalid_request', 'Edit needs the current code and an instruction');
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content:
        request.mode === 'edit'
          ? editUserMessage({
              project,
              bindings,
              language,
              locale,
              body: current,
              instruction: request.instruction!,
            })
          : generateUserMessage({ project, bindings, language, locale }),
    },
  ];

  let attempts = 0;
  let nudged = false;
  let last:
    | {
        code: string;
        explanation: string;
        libraries: string[];
        issues: ReturnType<typeof toMessages>;
      }
    | undefined;

  for (let turn = 1; turn <= maxRepairs + 4; turn++) {
    signal?.throwIfAborted();
    const msg = await abortable(
      client.turn({
        system: FIRMWARE_SYSTEM_PROMPT,
        tools: [SUBMIT_TOOL],
        messages,
        signal,
        onText: (delta) => emit({ type: 'text', delta }),
      }),
      signal,
    );
    track(msg);
    messages.push({ role: 'assistant', content: msg.content });
    const call = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_firmware',
    );

    if (!call) {
      if (!nudged) {
        nudged = true;
        messages.push({
          role: 'user',
          content: 'Call submit_firmware now with the complete body.',
        });
        continue;
      }
      break;
    }
    const fail = (text: string) =>
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: text }],
      });
    if (msg.stop_reason === 'max_tokens') {
      fail('Your output was cut off. Submit a more compact body.');
      continue;
    }
    const parsed = SubmitInput.safeParse(call.input);
    if (!parsed.success) {
      fail(
        `Invalid submit_firmware input: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
      continue;
    }

    attempts++;
    const code = composeFirmware(preamble, splitFirmware(parsed.data.body).body);
    const issues = toMessages(lintFirmware(code, language, bindings, board));
    last = {
      code,
      explanation: parsed.data.explanation.trim(),
      libraries: parsed.data.libraries,
      issues,
    };
    emit({ type: 'lint', attempt: attempts, issues });
    const errors = issues.filter((i) => i.severity === 'error');
    if (!errors.length || attempts > maxRepairs) break;
    emit({ type: 'repair', attempt: attempts, max: maxRepairs });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: JSON.stringify({
            problems: errors.map((e) => e.message),
            instruction:
              'Fix every problem and call submit_firmware again with the complete corrected body.',
          }),
        },
      ],
    });
  }

  if (!last) throw new AgentError('no_project', 'The model did not submit any firmware');
  return { ...base, ...last, ok: !last.issues.some((i) => i.severity === 'error'), attempts };
}
