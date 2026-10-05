'use client';

import { buildTimeline, type TimelineRow } from '@/ai/agent/timeline';
import type { AgentEvent, AgentResult } from '@/ai/agent/events';
import { formatViolation } from '@/core/erc';
import type { MessageKey } from '@/i18n';
import { useWorkspace } from '@/store/workspace';
import { useMemo } from 'react';
import { SEVERITY_STYLE } from './ErcPanel';
import { useT } from './useT';

/** Лента действий ИИ (поиск деталей, расчёты, проверка ERC, исправления, результат) — общая для главной и чата проекта. */
export function GenerationTimeline({
  events,
  running,
  error,
  onOpen,
}: {
  events: AgentEvent[];
  running: boolean;
  error: string | null;
  onOpen?: (p: NonNullable<AgentResult['project']>) => void;
}) {
  const t = useT();
  const timeline = useMemo(() => buildTimeline(events), [events]);
  return (
    <section aria-live="polite" className="flex flex-col gap-2">
      <ol className="flex flex-col gap-1.5">
        {timeline.rows.map((row, i) => (
          <Row key={i} row={row} onOpen={onOpen} />
        ))}
      </ol>
      {running && (
        <p className="text-muted flex items-center gap-2 text-sm">
          <Spinner /> {timeline.note || t('ai.thinking')}
        </p>
      )}
      {error && (
        <p role="alert" className="bg-danger-bg text-danger-fg rounded-lg px-3 py-2 text-sm">
          {t(`ai.error.${error}` as MessageKey)}
        </p>
      )}
    </section>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="border-accent inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent motion-reduce:animate-none"
    />
  );
}

function Row({
  row,
  onOpen,
}: {
  row: TimelineRow;
  onOpen?: (p: NonNullable<AgentResult['project']>) => void;
}) {
  const t = useT();
  const locale = useWorkspace((s) => s.locale);
  const base = 'flex items-start gap-2 text-sm';
  switch (row.kind) {
    case 'start':
      return (
        <li className={`${base} text-muted`}>
          <span aria-hidden>🤖</span>
          <span>
            {t('new.model')}: <span className="font-mono text-xs">{row.model}</span>
            {row.cached && <> · {t('new.cached')}</>}
          </span>
        </li>
      );
    case 'tool':
      return (
        <li className={base}>
          <span aria-hidden className="w-4 text-center">
            {row.status === 'running' ? <Spinner /> : row.status === 'ok' ? '✓' : '✕'}
          </span>
          <span className={row.status === 'error' ? 'text-danger' : ''}>
            {t(`ai.tool.${row.name}` as MessageKey)}
            {row.summary && (
              <span className="text-muted ml-2 font-mono text-xs">{row.summary}</span>
            )}
          </span>
        </li>
      );
    case 'erc': {
      const invalid = row.problems.length > 0;
      return (
        <li className={`${base} flex-col`}>
          <span className={row.ok ? 'font-medium' : 'text-danger font-medium'}>
            {row.ok
              ? '✓ ' + t('ai.erc.pass')
              : '✕ ' +
                (invalid
                  ? t('ai.erc.invalid', { n: row.problems.length })
                  : t('ai.erc.fail', { n: row.errors }))}
          </span>
          {!row.ok && (
            <ul className="mt-1 flex flex-col gap-1">
              {row.items
                .filter((i) => i.severity === 'error')
                .slice(0, 6)
                .map((it, k) => (
                  <li
                    key={k}
                    className={`rounded-md px-2 py-1 text-xs ${SEVERITY_STYLE[it.severity]}`}
                  >
                    {formatViolation(it as never, locale)}
                  </li>
                ))}
              {row.problems.slice(0, 6).map((p, k) => (
                <li
                  key={`p${k}`}
                  className={`rounded-md px-2 py-1 font-mono text-xs ${SEVERITY_STYLE.error}`}
                >
                  {p}
                </li>
              ))}
            </ul>
          )}
        </li>
      );
    }
    case 'repair':
      return (
        <li className={`${base} text-warn-fg`}>
          <span aria-hidden>🔧</span>
          {t('ai.repair', { attempt: row.attempt, max: row.max })}
        </li>
      );
    case 'done': {
      const r = row.result;
      const project = r.project;
      return (
        <li className={`${base} flex-col gap-2 pt-1`}>
          <div
            className={`w-full rounded-lg px-3 py-2 ${r.ok ? 'bg-info-bg text-info-fg' : 'bg-warn-bg text-warn-fg'}`}
          >
            <p className="font-medium">
              {r.ok
                ? t('new.resultOk')
                : r.project
                  ? t('new.resultErrors')
                  : t('new.resultInvalid')}
            </p>
            {!r.project && r.problems.length > 0 && (
              <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                {r.problems.slice(0, 6).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs opacity-80">
              {t('new.repairs', { n: r.repairs })} ·{' '}
              {t('new.tokens', { input: r.usage.inputTokens, output: r.usage.outputTokens })}
            </p>
          </div>
          {project && onOpen && (
            <button
              type="button"
              onClick={() => onOpen?.(project)}
              className="bg-accent focus-visible:outline-accent self-start rounded-md px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2"
            >
              {t('new.open')}
            </button>
          )}
        </li>
      );
    }
    case 'error':
      return (
        <li className={`${base} text-danger`}>
          <span aria-hidden>✕</span>
          {t(`ai.error.${row.code}` as MessageKey)}
        </li>
      );
  }
}
