'use client';

import Editor, { DiffEditor, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';

// Monaco берём из пакета (без CDN): так редактор работает офлайн и под строгим CSP.
let configured = false;
function configureMonaco() {
  if (configured) return;
  configured = true;
  (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker: () =>
      new Worker(new URL('monaco-editor/editor/editor.worker.js', import.meta.url), {
        type: 'module',
      }),
  };
  loader.config({ monaco });
}
configureMonaco();

export interface EditorMarker {
  line: number;
  severity: 'error' | 'warning';
  message: string;
}

const OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  wordWrap: 'on',
  renderLineHighlight: 'line',
  padding: { top: 8 },
};

export type MonacoLanguage = 'cpp' | 'python';

export function CodeEditor({
  value,
  onChange,
  language,
  dark,
  markers = [],
}: {
  value: string;
  onChange: (v: string) => void;
  language: MonacoLanguage;
  dark: boolean;
  markers?: EditorMarker[];
}) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      'circuitmind',
      markers.map((m) => ({
        startLineNumber: m.line,
        endLineNumber: m.line,
        startColumn: 1,
        endColumn: model.getLineMaxColumn(Math.min(m.line, model.getLineCount())),
        message: m.message,
        severity:
          m.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      })),
    );
  }, [markers, value]);

  return (
    <Editor
      value={value}
      language={language}
      theme={dark ? 'vs-dark' : 'vs'}
      options={OPTIONS}
      onChange={(v) => onChange(v ?? '')}
      onMount={(editor) => {
        editorRef.current = editor;
      }}
      loading={null}
    />
  );
}

export function CodeDiff({
  original,
  modified,
  language,
  dark,
}: {
  original: string;
  modified: string;
  language: MonacoLanguage;
  dark: boolean;
}) {
  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={language}
      theme={dark ? 'vs-dark' : 'vs'}
      options={{ ...OPTIONS, readOnly: true, renderSideBySide: false }}
      loading={null}
    />
  );
}
