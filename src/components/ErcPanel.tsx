'use client';

import { formatViolation, type Severity } from '@/core/erc';
import { useWorkspace } from '@/store/workspace';
import { useErc } from './useErc';
import { useT } from './useT';

export const SEVERITY_STYLE: Record<Severity, string> = {
  danger: 'bg-danger-bg text-danger-fg',
  error: 'bg-danger-bg text-danger-fg',
  warning: 'bg-warn-bg text-warn-fg',
  info: 'bg-info-bg text-info-fg',
};
const ICON: Record<Severity, string> = { danger: '☠', error: '✕', warning: '⚠', info: 'ℹ' };

export function ErcPanel() {
  const t = useT();
  const locale = useWorkspace((s) => s.locale);
  const report = useErc();
  if (!report) return null;
  const blocking = report.counts.error;
  const warnings = report.counts.warning + report.counts.danger;

  return (
    <section aria-labelledby="erc-title">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h2 id="erc-title" className="text-muted text-sm font-semibold">
          {t('erc.title')}
        </h2>
        <span className="text-muted text-xs">
          {t('erc.summary', { errors: blocking, warnings })}
        </span>
      </div>
      {report.violations.length === 0 ? (
        <p className="bg-info-bg text-info-fg rounded-lg px-3 py-2 text-sm">✓ {t('erc.ok')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {report.violations.map((v, i) => (
            <li
              key={i}
              className={`flex gap-2 rounded-lg px-3 py-2 text-sm ${SEVERITY_STYLE[v.severity]}`}
            >
              <span aria-hidden className="mt-0.5 w-4 shrink-0 text-center">
                {ICON[v.severity]}
              </span>
              <div>
                <span className="sr-only">{t(`erc.sev.${v.severity}`)}: </span>
                {formatViolation(v, locale)}
                {v.refs.length > 0 && v.refs[0] !== 'board' && (
                  <div className="mt-0.5 font-mono text-xs opacity-70">{v.refs.join(' · ')}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Компактный индикатор для строки вкладок. */
export function ErcBadge({ onClick }: { onClick: () => void }) {
  const t = useT();
  const report = useErc();
  if (!report) return null;
  const { error, warning, danger } = report.counts;
  const tone =
    error > 0
      ? 'bg-danger-bg text-danger-fg'
      : warning + danger > 0
        ? 'bg-warn-bg text-warn-fg'
        : 'bg-info-bg text-info-fg';
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('erc.summary', { errors: error, warnings: warning + danger })}
      className={`focus-visible:outline-accent my-1.5 flex shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium focus-visible:outline-2 ${tone}`}
    >
      ERC {error > 0 ? `✕ ${error}` : '✓'}
      {warning + danger > 0 && <span>⚠ {warning + danger}</span>}
    </button>
  );
}
