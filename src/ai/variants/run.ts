import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Inventory } from '@/core/inventory';
import { getBoard } from '@/core/library';
import {
  MIN_VARIANTS,
  VariantsInput,
  checkVariants,
  sortVariants,
  type Variant,
} from '@/core/variants';
import type { Locale } from '@/i18n';
import { abortable } from '../agent/abortable';
import { AgentError, type AgentUsage } from '../agent/events';
import type { ModelClient } from '../agent/model-client';
import {
  checkProject,
  executeTool,
  resolveBoard,
  toolDefinitions,
  type ToolContext,
} from '../agent/tools';
import type { RejectedVariant, VariantsEvent, VariantsResult } from './events';
import { VARIANTS_SYSTEM_PROMPT, variantsUserMessage } from './prompt';

export interface VariantsRequest {
  inventory: Inventory;
  wish?: string;
  locale: Locale;
}

export interface RunVariantsOptions {
  client: ModelClient;
  ctx: ToolContext;
  request: VariantsRequest;
  emit: (e: VariantsEvent) => void;
  signal?: AbortSignal;
  maxRepairs?: number;
  maxTurns?: number;
  maxOutputTokens?: number;
}

const LIBRARY_TOOLS = new Set(['list_boards', 'get_board', 'search_components', 'calculate']);

const suggestTool = (): Anthropic.Tool => {
  const { $schema, ...schema } = z.toJSONSchema(VariantsInput, {
    io: 'input',
    target: 'draft-7',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  void $schema;
  return {
    name: 'suggest_variants',
    description:
      'Submit 3-6 device variants buildable from the inventory (with at most 3 extra items). Each variant has a draft design (parts and connections) that is validated by the Electrical Rules Check and an inventory check. If problems are returned, fix them and call again with the complete list.',
    input_schema: schema as Anthropic.Tool['input_schema'],
    eager_input_streaming: true,
  } as Anthropic.Tool;
};

export const variantToolDefinitions = (): Anthropic.Tool[] => [
  ...toolDefinitions({ canGenerateBoards: false }).filter((t) => LIBRARY_TOOLS.has(t.name)),
  suggestTool(),
];

const describeCall = (name: string, input: unknown): string => {
  const a = (input ?? {}) as Record<string, unknown>;
  if (name === 'get_board') return String(a.boardId ?? '');
  if (name === 'search_components') return String(a.query ?? '') || String(a.category ?? '');
  if (name === 'calculate') return String(a.type ?? '');
  if (name === 'suggest_variants')
    return `${(a.variants as unknown[] | undefined)?.length ?? 0} variants`;
  return '';
};

/**
 * Режим 2: ИИ подбирает 3–6 вариантов из запасов пользователя. Каждый черновик проходит Zod → библиотека → ERC и проверку состава
 * (минимальная докупка); замечания возвращаются модели (до maxRepairs раз), затем отдаём лучшее, что получилось.
 */
export async function runVariantsAgent(opts: RunVariantsOptions): Promise<VariantsResult> {
  const {
    client,
    ctx,
    request,
    emit,
    signal,
    maxRepairs = 2,
    maxTurns = 12,
    maxOutputTokens = 120_000,
  } = opts;
  const tools = variantToolDefinitions();
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: variantsUserMessage(request) },
  ];
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let attempts = 0;
  let nudged = false;
  let best: { accepted: Variant[]; rejected: RejectedVariant[]; general: string[] } | undefined;

  const env = {
    inventory: request.inventory,
    checkProject: (p: Parameters<typeof checkProject>[0]) => checkProject(p, ctx),
    getBoard: async (id: string) => getBoard(id) ?? (await resolveBoard(ctx, id)),
  };
  const finish = (turns: number): VariantsResult => ({
    variants: sortVariants(best?.accepted ?? []),
    rejected: best?.rejected ?? [],
    general: best?.general ?? [],
    ok: (best?.accepted.length ?? 0) >= MIN_VARIANTS,
    repairs: Math.max(0, attempts - 1),
    turns,
    usage,
    model: client.model,
  });

  emit({ type: 'start', model: client.model });
  for (let turn = 1; turn <= maxTurns; turn++) {
    signal?.throwIfAborted();
    emit({ type: 'turn', n: turn });
    const msg = await abortable(
      client.turn({
        system: VARIANTS_SYSTEM_PROMPT,
        tools,
        messages,
        signal,
        onText: (delta) => emit({ type: 'text', delta }),
      }),
      signal,
    );
    usage.inputTokens += msg.usage.input_tokens;
    usage.outputTokens += msg.usage.output_tokens;
    usage.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
    if (msg.stop_reason === 'refusal')
      throw new AgentError('refused', 'The model declined this request');
    if (usage.outputTokens > maxOutputTokens)
      throw new AgentError('budget_exceeded', `Output token budget exceeded (${maxOutputTokens})`);

    messages.push({ role: 'assistant', content: msg.content });
    const calls = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const truncated = msg.stop_reason === 'max_tokens';
    if (!calls.length) {
      if (!nudged) {
        nudged = true;
        messages.push({
          role: 'user',
          content: truncated
            ? 'Your reply was cut off. Call suggest_variants with a more compact list.'
            : 'Call suggest_variants now.',
        });
        continue;
      }
      if (best) return finish(turn);
      throw new AgentError('no_project', 'The model finished without proposing variants');
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    let done = false;
    const ordered = [...calls].sort(
      (a, b) => Number(a.name === 'suggest_variants') - Number(b.name === 'suggest_variants'),
    );
    for (const call of ordered) {
      emit({
        type: 'tool',
        id: call.id,
        name: call.name,
        status: 'running',
        summary: describeCall(call.name, call.input),
      });
      if (truncated) {
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content:
            'Your output was cut off while writing this call. Retry with a more compact call.',
        });
        emit({ type: 'tool', id: call.id, name: call.name, status: 'error', summary: 'truncated' });
        continue;
      }
      if (call.name === 'suggest_variants') {
        attempts++;
        const check = await checkVariants(call.input, env);
        const rejected = Object.entries(check.problems).map(([id, problems]) => ({ id, problems }));
        emit({
          type: 'check',
          attempt: attempts,
          accepted: check.accepted.map((v) => v.id),
          rejected,
          general: check.general,
        });
        const clean =
          !rejected.length && !check.general.length && check.accepted.length >= MIN_VARIANTS;
        if (!best || check.accepted.length >= best.accepted.length)
          best = { accepted: check.accepted, rejected, general: check.general };
        if (clean || attempts > maxRepairs) {
          done = true;
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: 'Variants accepted.',
          });
          emit({
            type: 'tool',
            id: call.id,
            name: call.name,
            status: clean ? 'ok' : 'error',
            summary: `${check.accepted.length}/${(call.input as { variants?: unknown[] })?.variants?.length ?? '?'}`,
          });
        } else {
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            is_error: true,
            content: JSON.stringify({
              accepted: check.accepted.map((v) => v.id),
              problemsByVariant: check.problems,
              general: check.general,
              instruction:
                'Fix every problem and call suggest_variants again with the COMPLETE list of variants (keep the ones that were accepted).',
            }),
          });
          emit({
            type: 'tool',
            id: call.id,
            name: call.name,
            status: 'error',
            summary: `${rejected.length}`,
          });
          emit({ type: 'repair', attempt: attempts, max: maxRepairs });
        }
        continue;
      }
      if (!LIBRARY_TOOLS.has(call.name)) {
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: `Unknown tool "${call.name}"`,
        });
        emit({ type: 'tool', id: call.id, name: call.name, status: 'error' });
        continue;
      }
      try {
        const out = await executeTool(call.name, call.input, ctx);
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: !out.ok,
          content: out.content,
        });
        emit({
          type: 'tool',
          id: call.id,
          name: call.name,
          status: out.ok ? 'ok' : 'error',
          summary: out.summary,
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        console.error(`[variants] tool ${call.name} failed`, e);
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: 'Internal error while running the tool.',
        });
        emit({
          type: 'tool',
          id: call.id,
          name: call.name,
          status: 'error',
          summary: 'internal error',
        });
      }
    }
    if (done) return finish(turn);
    messages.push({ role: 'user', content: results });
  }
  if (best) return finish(maxTurns);
  throw new AgentError('no_project', `No variants after ${maxTurns} turns`);
}
