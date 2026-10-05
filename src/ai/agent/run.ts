import type Anthropic from '@anthropic-ai/sdk';
import type { Inventory } from '@/core/inventory';
import type { Project } from '@/core/schema';
import type { Locale } from '@/i18n';
import {
  AgentError,
  type AgentEvent,
  type AgentResult,
  type AgentUsage,
  type ErcItem,
} from './events';
import { abortable } from './abortable';
import type { ModelClient } from './model-client';
import { AGENT_SYSTEM_PROMPT, userMessage } from './system-prompt';
import {
  checkProject,
  executeTool,
  toolDefinitions,
  type ProjectCheck,
  type ToolContext,
} from './tools';

export interface AgentRequest {
  prompt: string;
  boardId?: string;
  locale: Locale;
  /** Черновик варианта из Режима 2: модель дорабатывает его до полного проекта. */
  seed?: Project;
  /** Запасы пользователя: использовать только их, докупки — минимум. */
  inventory?: Inventory;
}

export interface RunAgentOptions {
  client: ModelClient;
  ctx: ToolContext;
  request: AgentRequest;
  emit: (e: AgentEvent) => void;
  signal?: AbortSignal;
  /** Сколько раз проект можно вернуть на исправление после ошибок проверки. */
  maxRepairs?: number;
  maxTurns?: number;
  /** Потолок выходных токенов за весь запуск (защита от зацикливания и расходов). */
  maxOutputTokens?: number;
}

const ercItems = (check: ProjectCheck): ErcItem[] =>
  (check.report?.violations ?? []).map(({ severity, rule, refs, params }) => ({
    severity,
    rule,
    refs,
    params,
  }));

function describeCall(name: string, input: unknown): string {
  const a = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'get_board':
      return String(a.boardId ?? '');
    case 'ensure_board':
      return String(a.name ?? '');
    case 'search_components':
      return String(a.query ?? '') || String(a.category ?? '');
    case 'calculate':
      return String(a.type ?? '');
    case 'create_project': {
      const p = a as { parts?: unknown[]; connections?: unknown[]; title?: string };
      return `${p.title ?? ''} · ${p.parts?.length ?? 0} parts, ${p.connections?.length ?? 0} wires`;
    }
    default:
      return '';
  }
}

/**
 * Агентный цикл Режима 1: модель вызывает инструменты, финальный create_project проходит
 * Zod → ссылки на библиотеку → ERC. Ошибки возвращаются модели (до maxRepairs раз).
 * Если ошибки остаются, проект всё равно возвращается с ok=false — UI обязан показать нарушения.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const {
    client,
    ctx,
    request,
    emit,
    signal,
    maxRepairs = 3,
    maxTurns = 14,
    maxOutputTokens = 150_000,
  } = opts;
  const tools = toolDefinitions({ canGenerateBoards: !!ctx.generateBoardDraft });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage(request) }];
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let repairs = 0;
  let attempts = 0;
  let nudges = 0;
  let best: ProjectCheck | undefined;
  let last: ProjectCheck | undefined;

  const finish = (turns: number, check: ProjectCheck | undefined): AgentResult => ({
    project: check?.project ?? null,
    report: check?.report ?? null,
    ok: !!check?.ok,
    repairs,
    turns,
    usage,
    model: client.model,
    // проект не дошёл до ERC (схема/ссылки) — отдаём причины, чтобы UI объяснил, что пошло не так
    problems: (check ?? last) && !(check ?? last)!.report ? (check ?? last)!.problems : [],
  });

  emit({ type: 'start', model: client.model });

  for (let turn = 1; turn <= maxTurns; turn++) {
    signal?.throwIfAborted();
    emit({ type: 'turn', n: turn });
    const msg = await abortable(
      client.turn({
        system: AGENT_SYSTEM_PROMPT,
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

    // content передаём обратно как есть (в т.ч. thinking-блоки): модель продолжает с той же цепочкой рассуждений
    messages.push({ role: 'assistant', content: msg.content });
    const calls = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const truncated = msg.stop_reason === 'max_tokens';

    if (calls.length === 0) {
      if (nudges++ < 1) {
        messages.push({
          role: 'user',
          content: truncated
            ? 'Your reply was cut off. Continue and call create_project with a more compact project.'
            : 'You have not submitted the project yet. Call create_project now.',
        });
        continue;
      }
      if (best?.project) return finish(turn, best);
      throw new AgentError('no_project', 'The model finished without submitting a project');
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    let accepted: ProjectCheck | undefined;
    // create_project обрабатываем последним: сначала результаты поиска/расчётов
    const ordered = [...calls].sort(
      (a, b) => Number(a.name === 'create_project') - Number(b.name === 'create_project'),
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
      if (call.name === 'create_project') {
        const check = await checkProject(call.input, ctx);
        attempts++;
        last = check;
        if (check.project) best = check;
        emit({
          type: 'erc',
          attempt: attempts,
          ok: check.ok,
          errors: check.report?.counts.error ?? check.problems.length,
          warnings: (check.report?.counts.warning ?? 0) + (check.report?.counts.danger ?? 0),
          items: ercItems(check),
          problems: check.report ? [] : check.problems,
        });
        if (check.ok) {
          accepted = check;
          results.push({ type: 'tool_result', tool_use_id: call.id, content: 'Project accepted.' });
          emit({ type: 'tool', id: call.id, name: call.name, status: 'ok', summary: 'ERC ✓' });
        } else {
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            is_error: true,
            content: JSON.stringify({
              problems: check.problems,
              instruction:
                'Fix every problem and call create_project again with the complete corrected project.',
            }),
          });
          emit({
            type: 'tool',
            id: call.id,
            name: call.name,
            status: 'error',
            summary: `${check.problems.length}`,
          });
        }
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
        console.error(`[agent] tool ${call.name} failed`, e);
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: 'Internal error while running the tool. Try a different approach.',
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

    if (accepted) return finish(turn, accepted);
    if (!truncated && calls.some((c) => c.name === 'create_project')) {
      if (attempts > maxRepairs) return finish(turn, best); // лимит исправлений: отдаём лучшее, UI покажет нарушения
      repairs++;
      emit({ type: 'repair', attempt: repairs, max: maxRepairs });
    }
    messages.push({ role: 'user', content: results });
  }

  if (best?.project) return finish(maxTurns, best);
  throw new AgentError('no_project', `No project after ${maxTurns} turns`);
}
