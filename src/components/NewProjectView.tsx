'use client';

import { ArrowUp } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { AgentResult } from '@/ai/agent/events';
import type { MessageKey } from '@/i18n';
import { useWorkspace } from '@/store/workspace';
import { GenerationTimeline } from './GenerationTimeline';
import { useGeneration } from './useGeneration';
import { useT } from './useT';

const EXAMPLES: MessageKey[] = ['new.example1', 'new.example2', 'new.example3'];

/** Режим 1 «Хочу устройство»: описание → поток действий ИИ → проект. */
export function NewProjectView() {
  const t = useT();
  const locale = useWorkspace((s) => s.locale);
  const setGenerated = useWorkspace((s) => s.setGenerated);
  const [prompt, setPrompt] = useState('');

  const onDone = useCallback(
    (result: AgentResult) => {
      // проект сразу доступен в списке проектов, но экран с лентой действий остаётся — переход по кнопке
      if (result.project) setGenerated(result.project, false);
    },
    [setGenerated],
  );
  const { events, running, error, start, cancel } = useGeneration(onDone);
  const tooShort = prompt.trim().length < 8;

  return (
    <div className="relative min-h-full overflow-hidden">
      {/* фирменный визуал (Higgsfield): медные дорожки справа, плавно уходят в фон */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-cover bg-right opacity-0 dark:opacity-100"
        style={{
          backgroundImage: 'url(/brand/hero.jpg)',
          maskImage: 'linear-gradient(90deg, transparent 18%, #000 70%)',
          WebkitMaskImage: 'linear-gradient(90deg, transparent 18%, #000 70%)',
        }}
      />
      <div className="glow-accent pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative mr-auto flex w-full max-w-2xl flex-col gap-8 px-5 py-14 sm:px-8 sm:py-20 lg:ml-[6vw]">
        <header className="animate-fade-up flex flex-col gap-5">
          <span className="eyebrow border-line bg-panel/70 flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 backdrop-blur">
            <span className="bg-accent h-1.5 w-1.5 animate-pulse rounded-full" />
            {t('new.eyebrow')}
          </span>
          <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
            {t('new.title')}
            <span className="text-sheen block">{t('new.titleAccent')}</span>
          </h1>
          <p className="text-muted max-w-xl text-base sm:text-lg">{t('new.subtitle')}</p>
        </header>

        <form
          className="card animate-fade-up flex flex-col gap-3 p-3 backdrop-blur"
          style={{ ['--i' as string]: 2 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (tooShort || running) return;
            void start({ prompt: prompt.trim(), locale });
          }}
        >
          <label className="sr-only" htmlFor="prompt">
            {t('new.promptLabel')}
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            maxLength={1500}
            placeholder={t('new.promptPlaceholder')}
            className="text-fg placeholder:text-muted/70 w-full resize-none bg-transparent p-3 text-[15px] leading-relaxed focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
            <span className="text-muted ml-auto hidden text-xs sm:inline">
              {prompt.length}/1500
            </span>
            {running ? (
              <button
                type="button"
                onClick={cancel}
                className="border-line hover:bg-panel-2 focus-visible:outline-accent rounded-lg border px-5 py-2.5 text-sm font-medium focus-visible:outline-2"
              >
                {t('new.cancel')}
              </button>
            ) : (
              <button
                type="submit"
                disabled={tooShort}
                className="btn-primary focus-visible:outline-accent flex items-center gap-2 px-5 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('new.generate')}
                <ArrowUp size={16} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </form>

        <div
          className="animate-fade-up grid gap-3 sm:grid-cols-3"
          style={{ ['--i' as string]: 3 }}
          role="group"
          aria-label={t('new.examples')}
        >
          {EXAMPLES.map((key, i) => (
            <button
              key={key}
              type="button"
              onClick={() => setPrompt(t(key))}
              className="card card-hover focus-visible:outline-accent flex flex-col gap-2 p-4 text-left focus-visible:outline-2"
            >
              <span className="eyebrow !text-accent">0{i + 1}</span>
              <span className="text-muted line-clamp-3 text-[13px] leading-snug">{t(key)}</span>
            </button>
          ))}
        </div>

        {(events.length > 0 || running || error) && (
          <GenerationTimeline
            events={events}
            running={running}
            error={error}
            onOpen={(p) => setGenerated(p, true)}
          />
        )}
      </div>
    </div>
  );
}
