'use client';

import type { CompileResult } from '@/server/compile/types';
import type { MessageKey } from '@/i18n';
import { useT } from './useT';

export type BuildState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: CompileResult; code: string }
  | { status: 'error'; code: string };

const pct = (used: number, max: number) => Math.round((used / max) * 100);

function Bar({ used, max, label }: { used: number; max: number; label: string }) {
  const p = pct(used, max);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs">{label}</span>
      <div
        className="bg-canvas h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={p}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full ${p > 90 ? 'bg-danger' : p > 70 ? 'bg-warn-fg' : 'bg-accent'}`}
          style={{ width: `${Math.min(100, p)}%` }}
        />
      </div>
    </div>
  );
}

/** Вкладка «Вывод»: итог компиляции, размеры, ошибки компилятора, журнал и скачивание HEX. */
export function CompileOutput({
  build,
  currentCode,
  error,
  onDownloadHex,
  onRun,
}: {
  build: BuildState;
  currentCode: string;
  error: string | null;
  onDownloadHex: (hex: string) => void;
  onRun?: (hex: string) => void;
}) {
  const t = useT();
  if (build.status === 'running')
    return (
      <div className="text-muted p-4 text-sm" role="status">
        {t('code.compiling')}
      </div>
    );
  if (build.status === 'idle' && !error)
    return <div className="text-muted p-4 text-sm">{t('code.noBuild')}</div>;
  if (error || build.status === 'error')
    return (
      <p role="alert" className="bg-danger-bg text-danger-fg m-3 rounded-lg px-3 py-2 text-sm">
        {t(`ai.error.${error ?? 'compile_failed'}` as MessageKey)}
      </p>
    );
  if (build.status !== 'done') return null;

  const { result } = build;
  const stale = build.code !== currentCode;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm"
      aria-live="polite"
    >
      <div
        className={`rounded-lg px-3 py-2 ${result.ok ? 'bg-info-bg text-info-fg' : 'bg-danger-bg text-danger-fg'}`}
      >
        {result.timedOut
          ? t('ai.error.timeout')
          : result.ok
            ? result.cached
              ? t('code.compileOkCached')
              : t('code.compileOk', { ms: result.durationMs })
            : t('code.compileFail')}
      </div>
      {stale && (
        <p className="bg-warn-bg text-warn-fg rounded-lg px-3 py-2 text-xs">⚠ {t('code.stale')}</p>
      )}

      {result.ok && result.sizes && (
        <div className="flex flex-col gap-2">
          <Bar
            used={result.sizes.flashUsed}
            max={result.sizes.flashMax}
            label={t('code.flash', {
              used: result.sizes.flashUsed,
              max: result.sizes.flashMax,
              pct: pct(result.sizes.flashUsed, result.sizes.flashMax),
            })}
          />
          {result.sizes.ramUsed !== undefined && result.sizes.ramMax !== undefined && (
            <Bar
              used={result.sizes.ramUsed}
              max={result.sizes.ramMax}
              label={t('code.ram', {
                used: result.sizes.ramUsed,
                max: result.sizes.ramMax,
                pct: pct(result.sizes.ramUsed, result.sizes.ramMax),
              })}
            />
          )}
        </div>
      )}
      {result.ok && result.hex && (
        <div className="flex flex-wrap gap-2">
          {onRun && !stale && (
            <button
              type="button"
              onClick={() => onRun(result.hex!)}
              className="bg-accent focus-visible:outline-accent rounded-md px-3 py-1.5 text-sm font-semibold text-white focus-visible:outline-2"
            >
              ▶ {t('code.runInSim')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDownloadHex(result.hex!)}
            className="border-line bg-panel hover:bg-canvas focus-visible:outline-accent rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:outline-2"
          >
            ⬇ {t('code.downloadHex')}
          </button>
        </div>
      )}

      {result.diagnostics.length > 0 && (
        <section aria-label={t('code.diagnostics')}>
          <h3 className="text-muted mb-1 text-xs font-medium">{t('code.diagnostics')}</h3>
          <ul className="flex flex-col gap-1">
            {result.diagnostics.map((d, i) => (
              <li
                key={i}
                className={`rounded px-2 py-1 text-xs ${d.severity === 'error' ? 'bg-danger-bg text-danger-fg' : 'bg-warn-bg text-warn-fg'}`}
              >
                <span className="font-mono">{t('code.line', { line: d.line })}</span>: {d.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      <details>
        <summary className="text-muted cursor-pointer text-xs">{t('code.log')}</summary>
        <pre className="bg-canvas mt-1 max-h-72 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
          {result.log}
        </pre>
      </details>
    </div>
  );
}
