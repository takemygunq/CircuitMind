import type { ErcReport, Severity, Violation } from '@/core/erc';
import type { Project } from '@/core/schema';

/** События потока генерации. Сериализуются в NDJSON и используются UI — без зависимостей от SDK. */
export type AgentErrorCode =
  | 'ai_not_configured'
  | 'ai_rate_limited'
  | 'ai_unavailable'
  | 'rate_limited'
  | 'invalid_request'
  | 'refused'
  | 'no_project'
  | 'budget_exceeded'
  | 'timeout'
  | 'aborted';

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface AgentResult {
  /** null, если модель так и не прислала разбираемый проект. */
  project: Project | null;
  report: ErcReport | null;
  /** true — проект прошёл ERC без ошибок. false — показать ошибки пользователю. */
  ok: boolean;
  /** Сколько раз проект возвращали на исправление. */
  repairs: number;
  turns: number;
  usage: AgentUsage;
  model: string;
  cached?: boolean;
  /** Остались ошибки схемы/ссылок, не дошедшие до ERC. */
  problems: string[];
}

export interface ErcItem {
  severity: Severity;
  rule: Violation['rule'];
  refs: string[];
  params: Violation['params'];
}

export type AgentEvent =
  | { type: 'start'; model: string; cached?: boolean }
  | { type: 'turn'; n: number }
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; name: string; status: 'running' | 'ok' | 'error'; summary?: string }
  | {
      type: 'erc';
      attempt: number;
      ok: boolean;
      errors: number;
      warnings: number;
      items: ErcItem[];
      problems: string[];
    }
  | { type: 'repair'; attempt: number; max: number }
  | { type: 'done'; result: AgentResult }
  | { type: 'error'; code: AgentErrorCode; message: string };

export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}
