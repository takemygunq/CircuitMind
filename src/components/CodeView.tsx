'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CodeResult } from '@/ai/code/events';
import { exportFilename } from '@/core/export';
import { buildPinBindings, lintFirmware, templateFirmware, type FirmwareIssue } from '@/core/code';
import type { BoardDef, Language } from '@/core/schema';
import type { MessageKey } from '@/i18n';
import { codeKey, useWorkspace } from '@/store/workspace';
import { CompileOutput, type BuildState } from './CompileOutput';
import { useEmulator } from './EmulatorProvider';
import type { EditorMarker, MonacoLanguage } from './MonacoEditor';
import { downloadText } from './exporters';
import { useCodeRequest, type CodeRequestInput } from './useCodeRequest';
import { useT } from './useT';

const CodeEditor = dynamic(() => import('./MonacoEditor').then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});
const CodeDiff = dynamic(() => import('./MonacoEditor').then((m) => m.CodeDiff), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

function EditorSkeleton() {
  return (
    <div className="bg-canvas text-muted flex h-full items-center justify-center text-sm">…</div>
  );
}

const LANGUAGE_NAMES: Record<Language, string> = {
  arduino: 'Arduino C++',
  'esp-idf': 'ESP-IDF (C)',
  micropython: 'MicroPython',
  circuitpython: 'CircuitPython',
  python: 'Python (Raspberry Pi)',
};
const FILE_NAME: Record<Language, string> = {
  arduino: 'ino',
  'esp-idf': 'c',
  micropython: 'py',
  circuitpython: 'py',
  python: 'py',
};
const monacoLang = (l: Language): MonacoLanguage =>
  l === 'arduino' || l === 'esp-idf' ? 'cpp' : 'python';

interface Proposal {
  code: string;
  explanation: string;
  issues: FirmwareIssue[];
}

const btn =
  'focus-visible:outline-accent rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-40';
const btnNeutral = `${btn} border-line bg-panel hover:bg-canvas`;
const btnPrimary = `${btn} border-transparent bg-accent text-white`;

export function CodeView({ board }: { board: BoardDef }) {
  const t = useT();
  const project = useWorkspace((s) => s.project);
  const projectId = useWorkspace((s) => s.projectId);
  const locale = useWorkspace((s) => s.locale);
  const dark = useWorkspace((s) => s.theme === 'dark');
  const codeFiles = useWorkspace((s) => s.codeFiles);
  const setCode = useWorkspace((s) => s.setCode);

  const [language, setLanguage] = useState<Language>(board.languages[0]);
  const lang = board.languages.includes(language) ? language : board.languages[0];
  const key = codeKey(projectId, lang);
  const code = codeFiles[key] ?? '';
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [panel, setPanel] = useState<'pins' | 'output'>('output');
  const [compiler, setCompiler] = useState<{ available: boolean; boards: string[] } | null>(null);
  const [build, setBuild] = useState<BuildState>({ status: 'idle' });
  const [buildError, setBuildError] = useState<string | null>(null);
  const setStoredBuild = useWorkspace((s) => s.setBuild);
  const emu = useEmulator();
  const setTab = useWorkspace((s) => s.setTab);
  const setSimOn = useWorkspace((s) => s.setSimOn);
  const addChat = useWorkspace((s) => s.addChat);
  const setCodeBusy = useWorkspace((s) => s.setCodeBusy);
  // общий чат проекта (слева): ответы ИИ по коду пишем туда же
  const chatKey = () => useWorkspace.getState().savedId ?? useWorkspace.getState().projectId;
  const [copied, setCopied] = useState(false);

  const bindings = useMemo(() => buildPinBindings(project, board), [project, board]);
  const lintOf = useCallback(
    (c: string) => lintFirmware(c, lang, bindings, board),
    [lang, bindings, board],
  );
  const issues = useMemo(() => (code.trim() ? lintOf(code) : []), [code, lintOf]);
  const markers: EditorMarker[] = useMemo(() => {
    const fromLint = issues
      .filter((i) => i.line !== undefined)
      .map((i) => ({ line: i.line!, severity: i.severity, message: describe(t, i) }));
    const fromBuild =
      build.status === 'done' && build.code === code
        ? build.result.diagnostics.map((d) => ({
            line: d.line,
            severity: d.severity,
            message: d.message,
          }))
        : [];
    return [...fromLint, ...fromBuild];
  }, [issues, t, build, code]);

  useEffect(() => {
    let alive = true;
    fetch('/api/compile')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setCompiler(d))
      .catch(() => alive && setCompiler({ available: false, boards: [] }));
    return () => {
      alive = false;
    };
  }, []);
  const canCompile =
    lang === 'arduino' && !!compiler?.available && compiler.boards.includes(board.id);

  const compile = async () => {
    setPanel('output');
    setBuild({ status: 'running' });
    setBuildError(null);
    try {
      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, boardId: board.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBuild({ status: 'idle' });
        setBuildError(
          ['compiler_unavailable', 'busy', 'compile_unsupported', 'rate_limited'].includes(
            data.error,
          )
            ? data.error
            : 'compile_failed',
        );
        return;
      }
      setBuild({ status: 'done', result: data, code });
      setStoredBuild(key, data.ok && data.hex ? { code, hex: data.hex } : null);
    } catch {
      setBuild({ status: 'error', code });
    }
  };

  const propose = useCallback(
    (next: string, explanation: string) => {
      if (!code.trim()) {
        setCode(key, next);
        return;
      }
      setProposal({ code: next, explanation, issues: lintOf(next) });
    },
    [code, key, setCode, lintOf],
  );

  const onDone = useCallback(
    (result: CodeResult) => {
      if (result.mode === 'explain') {
        addChat(chatKey(), { role: 'assistant', text: result.explanation });
        return;
      }
      const libs = result.libraries.length
        ? `\n\n${t('code.libraries', { list: result.libraries.join(', ') })}`
        : '';
      addChat(chatKey(), { role: 'assistant', text: result.explanation + libs });
      propose(result.code, result.explanation);
    },
    [propose, t, addChat],
  );
  const { running, error, start, cancel } = useCodeRequest(onDone);

  const base = (action: CodeRequestInput['action']): CodeRequestInput => ({
    action,
    project,
    language: lang,
    locale,
    code: code || undefined,
  });

  // запросы из общего чата слева: «изменить» (или «сгенерировать», если кода ещё нет) и «объяснить»
  const codeAsk = useWorkspace((st) => st.codeAsk);
  const handled = useRef(0);
  useEffect(() => {
    if (!codeAsk || codeAsk.n === handled.current || running) return;
    handled.current = codeAsk.n;
    if (codeAsk.explain && code.trim())
      void start({ ...base('explain'), instruction: codeAsk.text });
    else
      void start({
        ...base(code.trim() ? 'edit' : 'generate'),
        instruction: code.trim() ? codeAsk.text : undefined,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeAsk]);
  useEffect(() => {
    setCodeBusy(running);
    return () => setCodeBusy(false);
  }, [running, setCodeBusy]);
  useEffect(() => {
    if (error)
      addChat(chatKey(), {
        role: 'assistant',
        text: t(`ai.error.${error}` as MessageKey),
        error: true,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* буфер обмена недоступен */
    }
  };

  const hasCode = code.trim().length > 0;
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <section
        className="flex min-h-[60vh] min-w-0 flex-1 flex-col lg:min-h-0"
        aria-label={t('tab.code')}
      >
        <div className="border-line bg-panel flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted">{t('code.language')}</span>
            <select
              value={lang}
              onChange={(e) => (setLanguage(e.target.value as Language), setProposal(null))}
              className="border-line bg-panel text-fg focus-visible:outline-accent rounded-md border px-2 py-1.5 text-sm focus-visible:outline-2"
            >
              {board.languages.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_NAMES[l]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={btnPrimary}
            disabled={running}
            onClick={() => void start(base('generate'))}
          >
            ✨ {hasCode ? t('code.regenerate') : t('code.generate')}
          </button>
          {running && (
            <button type="button" className={btnNeutral} onClick={cancel}>
              {t('new.cancel')}
            </button>
          )}
          <button
            type="button"
            className={btnNeutral}
            disabled={running}
            onClick={() => propose(templateFirmware(project, board, lang), '')}
          >
            {t('code.template')}
          </button>
          <button
            type="button"
            className={btnNeutral}
            disabled={running || !hasCode}
            onClick={() => void start(base('explain'))}
          >
            {t('code.explain')}
          </button>
          {lang === 'arduino' && (
            <button
              type="button"
              className={btnNeutral}
              disabled={!canCompile || !hasCode || build.status === 'running'}
              title={
                !compiler?.available
                  ? t('code.compileUnavailable')
                  : !canCompile
                    ? t('code.compileUnsupported')
                    : undefined
              }
              onClick={() => void compile()}
            >
              ⚙ {build.status === 'running' ? t('code.compiling') : t('code.compile')}
            </button>
          )}
          <span className="ml-auto flex gap-2">
            <button type="button" className={btnNeutral} disabled={!hasCode} onClick={copy}>
              {copied ? `✓ ${t('code.copied')}` : t('code.copy')}
            </button>
            <button
              type="button"
              className={btnNeutral}
              disabled={!hasCode}
              onClick={() =>
                downloadText(
                  exportFilename(project, lang === 'arduino' ? '' : lang, FILE_NAME[lang]),
                  'text/plain',
                  code,
                )
              }
            >
              ⬇ {t('code.download')}
            </button>
          </span>
        </div>

        {proposal && (
          <div className="border-line bg-info-bg text-info-fg flex flex-wrap items-center gap-3 border-b px-3 py-2 text-sm">
            <strong>{t('code.proposal')}</strong>
            {proposal.issues.some((i) => i.severity === 'error') && (
              <span className="text-warn-fg">⚠ {t('code.proposalIssues')}</span>
            )}
            <span className="ml-auto flex gap-2">
              <button
                type="button"
                className={btnPrimary}
                onClick={() => (setCode(key, proposal.code), setProposal(null))}
              >
                {t('code.accept')}
              </button>
              <button type="button" className={btnNeutral} onClick={() => setProposal(null)}>
                {t('code.reject')}
              </button>
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {proposal ? (
            <CodeDiff
              original={code}
              modified={proposal.code}
              language={monacoLang(lang)}
              dark={dark}
            />
          ) : hasCode ? (
            <CodeEditor
              value={code}
              onChange={(v) => setCode(key, v)}
              language={monacoLang(lang)}
              dark={dark}
              markers={markers}
            />
          ) : (
            <div className="bg-canvas flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-lg font-semibold">{t('code.empty')}</p>
              <p className="text-muted max-w-md text-sm">{t('code.emptyHint')}</p>
            </div>
          )}
        </div>

        <div
          className="border-line bg-panel max-h-40 overflow-y-auto border-t px-3 py-2 text-xs"
          aria-live="polite"
        >
          <div className="text-muted mb-1 font-medium">{t('code.problems')}</div>
          {issues.length === 0 ? (
            <p className="text-muted">{t('code.noProblems')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {issues.map((i, k) => (
                <li
                  key={k}
                  className={`rounded px-2 py-1 ${i.severity === 'error' ? 'bg-danger-bg text-danger-fg' : 'bg-warn-bg text-warn-fg'}`}
                >
                  <span className="font-semibold">{t(`code.sev.${i.severity}` as MessageKey)}</span>
                  {i.line !== undefined && (
                    <span className="ml-1 opacity-70">({t('code.line', { line: i.line })})</span>
                  )}
                  : {describe(t, i)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <aside className="border-line bg-panel flex max-h-full flex-col overflow-hidden border-t lg:w-96 lg:shrink-0 lg:border-t-0 lg:border-l">
        <div role="tablist" className="border-line flex border-b">
          {(['output', 'pins'] as const).map((p) => (
            <button
              key={p}
              role="tab"
              type="button"
              aria-selected={panel === p}
              onClick={() => setPanel(p)}
              className={`focus-visible:outline-accent flex-1 border-b-2 px-3 py-2 text-sm focus-visible:outline-2 ${panel === p ? 'border-accent font-semibold' : 'text-muted border-transparent'}`}
            >
              {t(p === 'pins' ? 'code.pins' : 'code.output')}
            </button>
          ))}
        </div>

        {panel === 'output' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <CompileOutput
              build={build}
              currentCode={code}
              error={buildError}
              onRun={
                emu.eligible
                  ? (hex) => (emu.start(hex), setSimOn(true), setTab('diagram'))
                  : undefined
              }
              onDownloadHex={(hex) =>
                downloadText(exportFilename(project, board.id, 'hex'), 'text/plain', hex)
              }
            />
          </div>
        ) : panel === 'pins' ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
            <p className="text-muted mb-2 text-xs">{t('code.pinsHint')}</p>
            {bindings.length === 0 ? (
              <p className="text-muted">{t('code.noPins')}</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 font-medium">{t('code.pinCol.const')}</th>
                    <th className="py-1 font-medium">{t('code.pinCol.pin')}</th>
                    <th className="py-1 font-medium">{t('code.pinCol.role')}</th>
                    <th className="py-1 font-medium">{t('code.pinCol.to')}</th>
                  </tr>
                </thead>
                <tbody className="divide-line divide-y">
                  {bindings.map((b) => (
                    <tr key={b.name}>
                      <td className="py-1.5 font-mono font-semibold">{b.name}</td>
                      <td className="py-1.5 font-mono">{b.boardPin}</td>
                      <td className="py-1.5">{t(`code.role.${b.role}` as MessageKey)}</td>
                      <td className="py-1.5">{b.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function describe(t: ReturnType<typeof useT>, i: FirmwareIssue): string {
  const p = i.params as Record<string, string | number>;
  return t(`code.lint.${i.code}` as MessageKey, p);
}
