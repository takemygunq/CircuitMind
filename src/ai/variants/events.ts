import type { Variant } from '@/core/variants';
import type { AgentErrorCode, AgentUsage } from '../agent/events';

export interface RejectedVariant {
  id: string;
  problems: string[];
}

export interface VariantsResult {
  /** Принятые варианты (прошли ERC и проверку состава), отсортированы: сначала только из запасов. */
  variants: Variant[];
  /** Варианты, которые не удалось довести до рабочих за отведённые исправления. */
  rejected: RejectedVariant[];
  general: string[];
  /** Получено не меньше 3 вариантов. */
  ok: boolean;
  repairs: number;
  turns: number;
  usage: AgentUsage;
  model: string;
  cached?: boolean;
}

export type VariantsEvent =
  | { type: 'start'; model: string; cached?: boolean }
  | { type: 'turn'; n: number }
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; name: string; status: 'running' | 'ok' | 'error'; summary?: string }
  | {
      type: 'check';
      attempt: number;
      accepted: string[];
      rejected: RejectedVariant[];
      general: string[];
    }
  | { type: 'repair'; attempt: number; max: number }
  | { type: 'done'; result: VariantsResult }
  | { type: 'error'; code: AgentErrorCode; message: string };
