'use client';

import { useCallback, useRef, useState } from 'react';
import type { AgentErrorCode, AgentEvent, AgentResult } from '@/ai/agent/events';
import { NdjsonParser } from '@/ai/agent/ndjson';
import type { Inventory } from '@/core/inventory';
import type { Project } from '@/core/schema';
import type { Locale } from '@/i18n';

export interface GenerationInput {
  prompt: string;
  boardId?: string;
  locale: Locale;
  /** Режим 2: черновик варианта и запасы пользователя. */
  seed?: Project;
  inventory?: Inventory;
}
export type GenerationErrorCode = AgentErrorCode | 'busy' | 'unknown_board' | 'invalid' | 'network';

const HTTP_CODES: Record<string, GenerationErrorCode> = {
  rate_limited: 'rate_limited',
  busy: 'busy',
  invalid_request: 'invalid',
  unknown_board: 'unknown_board',
  ai_not_configured: 'ai_not_configured',
};

/** Запускает генерацию и читает NDJSON-поток событий с сервера. */
export function useGeneration(onDone?: (result: AgentResult) => void) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<GenerationErrorCode | null>(null);
  const abort = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abort.current?.abort(), []);

  const start = useCallback(
    async (input: GenerationInput) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setEvents([]);
      setError(null);
      setRunning(true);
      let finished = false;
      try {
        const res = await fetch('/api/projects/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(
            HTTP_CODES[data.error ?? ''] ?? (res.status >= 500 ? 'ai_unavailable' : 'invalid'),
          );
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = new NdjsonParser();
        const handle = (batch: AgentEvent[]) => {
          if (!batch.length) return;
          setEvents((prev) => [...prev, ...batch]);
          for (const e of batch) {
            if (e.type === 'done') {
              finished = true;
              onDone?.(e.result);
            } else if (e.type === 'error') finished = true;
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

  return { events, running, error, start, cancel };
}
