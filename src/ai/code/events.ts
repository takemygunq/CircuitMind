import type { Language } from '@/core/schema';
import type { AgentErrorCode, AgentUsage } from '../agent/events';

export type CodeMode = 'generate' | 'edit' | 'explain';

export interface LintMessage {
  severity: 'error' | 'warning';
  code: string;
  line?: number;
  /** Текст на английском (для ИИ и логов); UI показывает по code + params на языке интерфейса. */
  message: string;
  params: Record<string, string | number>;
}

export interface CodeResult {
  mode: CodeMode;
  language: Language;
  /** Полный файл (блок пинов + тело). Для explain — пусто. */
  code: string;
  /** Пояснение модели (как работает код / что изменено). */
  explanation: string;
  libraries: string[];
  issues: LintMessage[];
  /** Нет ошибок линтера. */
  ok: boolean;
  attempts: number;
  usage: AgentUsage;
  model: string;
  cached?: boolean;
}

export type CodeEvent =
  | { type: 'start'; mode: CodeMode; model: string; cached?: boolean }
  | { type: 'text'; delta: string }
  | { type: 'lint'; attempt: number; issues: LintMessage[] }
  | { type: 'repair'; attempt: number; max: number }
  | { type: 'done'; result: CodeResult }
  | { type: 'error'; code: AgentErrorCode; message: string };
