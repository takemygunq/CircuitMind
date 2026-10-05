'use client';

import { useEffect, useRef, useState } from 'react';
import { codeKey, useWorkspace } from '@/store/workspace';
import { useEmulator } from './EmulatorProvider';
import { useT } from './useT';

const SPEEDS = [0.25, 1, 4];

/** Управление эмулятором прошивки: запуск собранного HEX, скорость, монитор порта. */
export function FirmwarePanel() {
  const t = useT();
  const emu = useEmulator();
  const projectId = useWorkspace((s) => s.projectId);
  const build = useWorkspace((s) => s.builds[codeKey(s.projectId, 'arduino')]);
  const code = useWorkspace((s) => s.codeFiles[codeKey(s.projectId, 'arduino')] ?? '');
  const setTab = useWorkspace((s) => s.setTab);
  const [input, setInput] = useState('');
  const log = useRef<HTMLPreElement>(null);
  void projectId;

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [emu.serial]);

  const btn =
    'focus-visible:outline-accent rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-40';
  if (!emu.eligible)
    return (
      <section aria-labelledby="fw-title" className="border-line rounded-md border p-3">
        <h3 id="fw-title" className="mb-1 text-xs font-medium">
          {t('sim.fw.title')}
        </h3>
        <p className="text-muted text-xs">{t('sim.fw.notAvr')}</p>
      </section>
    );

  const running = emu.status === 'running';
  const stale = !!build && build.code !== code;
  return (
    <section
      aria-labelledby="fw-title"
      className="border-line flex flex-col gap-2 rounded-md border p-3"
    >
      <h3 id="fw-title" className="text-xs font-medium">
        {t('sim.fw.title')}
      </h3>
      {!build ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted text-xs">{t('sim.fw.noBuild')}</p>
          <button
            type="button"
            className={`${btn} border-line bg-panel hover:bg-canvas`}
            onClick={() => setTab('code')}
          >
            {t('sim.fw.goCode')}
          </button>
        </div>
      ) : (
        <>
          {stale && (
            <p className="bg-warn-bg text-warn-fg rounded px-2 py-1 text-xs">
              ⚠ {t('sim.fw.stale')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`${btn} bg-accent border-transparent text-white`}
              onClick={() => emu.start(build.hex)}
            >
              {running ? `↻ ${t('sim.fw.restart')}` : `▶ ${t('sim.fw.start')}`}
            </button>
            <button
              type="button"
              className={`${btn} border-line bg-panel hover:bg-canvas`}
              disabled={!running}
              onClick={emu.stop}
            >
              ■ {t('sim.fw.stop')}
            </button>
            <label className="ml-auto flex items-center gap-1 text-xs">
              <span className="text-muted">{t('sim.fw.speed')}</span>
              <select
                value={emu.speed}
                onChange={(e) => emu.setSpeed(Number(e.target.value))}
                className="border-line bg-panel rounded border px-1 py-1 text-xs"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-muted text-xs" role="status">
            {running
              ? t('sim.fw.running', { sec: (emu.elapsedMs / 1000).toFixed(1) })
              : t('sim.fw.stopped')}
          </p>
        </>
      )}
      {emu.error && (
        <p role="alert" className="bg-danger-bg text-danger-fg rounded px-2 py-1 text-xs">
          {t('sim.fw.error', { msg: emu.error })}
        </p>
      )}

      {(running || emu.serial) && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted font-medium">{t('sim.fw.serial')}</span>
            <button type="button" className="text-accent underline" onClick={emu.clearSerial}>
              {t('sim.fw.clear')}
            </button>
          </div>
          <pre
            ref={log}
            className="bg-canvas max-h-40 min-h-12 overflow-auto rounded p-2 font-mono text-xs whitespace-pre-wrap"
            aria-live="off"
          >
            {emu.serial}
          </pre>
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!input) return;
              emu.sendSerial(input + '\n');
              setInput('');
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('sim.fw.placeholder')}
              aria-label={t('sim.fw.serial')}
              disabled={!running}
              className="border-line bg-canvas text-fg focus-visible:outline-accent min-w-0 flex-1 rounded border px-2 py-1 font-mono text-xs focus-visible:outline-2 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!running || !input}
              className={`${btn} border-line bg-panel hover:bg-canvas`}
            >
              {t('sim.fw.send')}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
