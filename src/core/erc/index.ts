import { translate, type Locale, type MessageKey } from '../../i18n';
import type { Project } from '../schema';
import { boardFor, ErcContext, type ErcOptions } from './context';
import { electricalRules } from './rules/electrical';
import { partRules } from './rules/parts';
import { pinRules } from './rules/pins';
import { structureRules } from './rules/structure';
import { valueRules } from './rules/values';
import type { ErcReport, Severity, Violation } from './types';

export * from './types';
export * from './analysis';
export type { ErcOptions } from './context';

const ORDER: Severity[] = ['danger', 'error', 'warning', 'info'];

/** Electrical Rules Check: детерминированная проверка проекта. Не зависит от ИИ, UI и сети. */
export function runErc(project: Project, opts: ErcOptions = {}): ErcReport {
  const board = boardFor(project, opts);
  if (!board) {
    const v: Violation = {
      rule: 'unknown_board',
      severity: 'error',
      refs: ['board'],
      params: { id: project.boardId },
    };
    return summarize([v]);
  }
  const ctx = new ErcContext(project, board, opts);
  structureRules(ctx);
  pinRules(ctx);
  electricalRules(ctx);
  partRules(ctx);
  valueRules(ctx);
  return summarize(ctx.violations);
}

function summarize(list: Violation[]): ErcReport {
  const violations = [...list].sort(
    (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity),
  );
  const counts = { danger: 0, error: 0, warning: 0, info: 0 } satisfies Record<Severity, number>;
  for (const v of violations) counts[v.severity]++;
  return { violations, counts, ok: counts.error === 0 };
}

export function formatViolation(v: Violation, locale: Locale = 'en'): string {
  return translate(locale, `erc.${v.rule}` as MessageKey, v.params);
}

/** Текст для ИИ при автоматическом исправлении проекта: только то, что нужно чинить. */
export function violationsForAi(report: ErcReport): string[] {
  return report.violations
    .filter((v) => v.severity === 'error')
    .map((v) => `[${v.rule}] ${formatViolation(v, 'en')} (${v.refs.join(', ')})`);
}
