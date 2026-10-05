'use client';

import { useCallback, useRef, useState } from 'react';
import type { CodeEvent, CodeMode, CodeResult } from '@/ai/code/events';
import { NdjsonParser } from '@/ai/agent/ndjson';
import type { Language, Project } from '@/core/schema';
import type { Locale } from '@/i18n';

export interface CodeRequestInput {
  action: CodeMode;
  project: Project;
  language: Language;
  locale: Locale;
  code?: string;
  instruction?: string;
}
export type CodeErrorCode = string;

/** Запрос к /api/code: читает поток событий, отдаёт итоговый результат в onDone. */
export function useCodeRequest(onDone: (result: CodeResult, input: CodeRequestInput) => void) {
  const [events, setEvents] = useState<CodeEvent[]>([]);
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<CodeErrorCode | null>(null);
  const abort = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abort.current?.abort(), []);

  const start = useCallback(
    async (input: CodeRequestInput) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setEvents([]);
      setText('');
      setError(null);
      setRunning(true);
      let finished = false;
      try {
        const res = await fetch('/api/code', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(
            data.error === 'rate_limited'
              ? 'rate_limited'
              : data.error === 'ai_not_configured'
                ? 'ai_not_configured'
                : res.status >= 500
                  ? 'ai_unavailable'
                  : 'invalid_request',
          );
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = new NdjsonParser<CodeEvent>();
        const handle = (batch: CodeEvent[]) => {
          for (const e of batch) {
            if (e.type === 'text') setText((t) => t + e.delta);
            else setEvents((prev) => [...prev, e]);
            if (e.type === 'done') {
              finished = true;
              onDone(e.result, input);
            } else if (e.type === 'error') {
              finished = true;
              setError(e.code);
            }
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          handle(parser.push(decoder.decode(value, { stream: true })));
        }
        handle(parser.flush());
        if (!finished) setError('network');
      } catch (e) {
        setError((e as { name?: string }).name === 'AbortError' ? 'aborted' : 'network');
      } finally {
        setRunning(false);
      }
    },
    [onDone],
  );

  return { events, text, running, error, start, cancel };
}
