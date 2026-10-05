import type { AgentErrorCode, AgentEvent, AgentResult, ErcItem } from './events';

export type TimelineRow =
  | { kind: 'start'; model: string; cached: boolean }
  | { kind: 'tool'; id: string; name: string; status: 'running' | 'ok' | 'error'; summary?: string }
  | {
      kind: 'erc';
      attempt: number;
      ok: boolean;
      errors: number;
      warnings: number;
      items: ErcItem[];
      problems: string[];
    }
  | { kind: 'repair'; attempt: number; max: number }
  | { kind: 'done'; result: AgentResult }
  | { kind: 'error'; code: AgentErrorCode; message: string };

export interface Timeline {
  rows: TimelineRow[];
  /** Последняя реплика модели (обрезана) — «что модель пишет сейчас». */
  note: string;
  turn: number;
  finished: boolean;
}

/** События потока → строки ленты статуса. Вызовы инструментов обновляются на месте по id. */
export function buildTimeline(events: AgentEvent[]): Timeline {
  const rows: TimelineRow[] = [];
  const toolAt = new Map<string, number>();
  let note = '';
  let turn = 0;
  let finished = false;
  for (const e of events) {
    switch (e.type) {
      case 'start':
        rows.push({ kind: 'start', model: e.model, cached: !!e.cached });
        break;
      case 'turn':
        turn = e.n;
        note = '';
        break;
      case 'text':
        note = (note + e.delta).slice(-160);
        break;
      case 'tool': {
        const row: TimelineRow = {
          kind: 'tool',
          id: e.id,
          name: e.name,
          status: e.status,
          summary: e.summary,
        };
        const at = toolAt.get(e.id);
        if (at === undefined) {
          toolAt.set(e.id, rows.length);
          rows.push(row);
        } else
          rows[at] = {
            ...(rows[at] as TimelineRow & { kind: 'tool' }),
            status: e.status,
            summary: e.summary ?? (rows[at] as { summary?: string }).summary,
          };
        break;
      }
      case 'erc':
        rows.push({
          kind: 'erc',
          attempt: e.attempt,
          ok: e.ok,
          errors: e.errors,
          warnings: e.warnings,
          items: e.items,
          problems: e.problems,
        });
        break;
      case 'repair':
        rows.push({ kind: 'repair', attempt: e.attempt, max: e.max });
        break;
      case 'done':
        rows.push({ kind: 'done', result: e.result });
        finished = true;
        break;
      case 'error':
        rows.push({ kind: 'error', code: e.code, message: e.message });
        finished = true;
        break;
    }
  }
  return { rows, note, turn, finished };
}
