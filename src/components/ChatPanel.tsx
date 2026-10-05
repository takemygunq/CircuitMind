'use client';

import { ArrowUp } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentResult } from '@/ai/agent/events';
import { projectTexts } from '@/i18n/library';
import { useWorkspace } from '@/store/workspace';
import { GenerationTimeline, Spinner } from './GenerationTimeline';
import { useGeneration } from './useGeneration';
import { useT } from './useT';

/** Чат проекта (слева от схем): описываете изменение — ИИ дорабатывает текущий проект и обновляет все виды. */
export function ChatPanel() {
  const t = useT();
  const project = useWorkspace((s) => s.project);
  const projectId = useWorkspace((s) => s.projectId);
  const savedId = useWorkspace((s) => s.savedId);
  const inventory = useWorkspace((s) => s.inventory);
  const locale = useWorkspace((s) => s.locale);
  const setGenerated = useWorkspace((s) => s.setGenerated);
  const addChat = useWorkspace((s) => s.addChat);
  const tab = useWorkspace((s) => s.tab);
  const setCodeAsk = useWorkspace((s) => s.setCodeAsk);
  const codeBusy = useWorkspace((s) => s.codeBusy);
  const onCode = tab === 'code';
  const key = savedId ?? projectId;
  const texts = projectTexts(projectId, project, locale);
  const messages = useWorkspace((s) => s.chats[key]);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const onDone = useCallback(
    (r: AgentResult) => {
      const st = useWorkspace.getState();
      const chatKey = st.savedId ?? st.projectId;
      if (r.project) {
        setGenerated(r.project, false, st.savedId);
        addChat(chatKey, { role: 'assistant', text: t('chat.done') });
      } else addChat(chatKey, { role: 'assistant', text: t('chat.failed'), error: true });
    },
    [setGenerated, addChat, t],
  );
  const { events, running, error, start, cancel } = useGeneration(onDone);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages?.length, events.length]);

  const send = (explain = false) => {
    const prompt = text.trim();
    if (prompt.length < 4 || running || codeBusy) return;
    addChat(key, { role: 'user', text: prompt });
    setText('');
    // на вкладке «Код» чат правит или объясняет прошивку; на остальных — дорабатывает весь проект
    if (onCode) {
      setCodeAsk({ text: prompt, explain });
      return;
    }
    void start({
      prompt: `Change request for the current project "${project.title}": ${prompt}`,
      boardId: project.boardId,
      locale,
      seed: project,
      inventory: inventory.items.length ? inventory : undefined,
    });
  };

  return (
    <section
      className="border-line flex w-full shrink-0 flex-col border-b lg:w-[22rem] lg:border-r lg:border-b-0"
      aria-label={t('chat.title')}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ol className="flex flex-col gap-3">
          <li className="card text-muted p-3 text-[13px] leading-relaxed">
            <p className="text-fg mb-1 font-medium">{texts.title}</p>
            {texts.description}
            <p className="mt-2 text-xs">{t('chat.loaded')}</p>
          </li>
          {messages?.map((m) => (
            <li
              key={m.id}
              className={
                m.role === 'user'
                  ? 'bg-panel-2 text-fg ml-6 rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13px] leading-relaxed'
                  : `card px-3 py-2 text-[13px] ${m.error ? 'text-danger' : 'text-muted'}`
              }
            >
              {m.text}
            </li>
          ))}
          {codeBusy && (
            <li className="card text-muted flex items-center gap-2 px-3 py-2 text-[13px]">
              <Spinner /> {t('code.working')}
            </li>
          )}
          {(running || events.length > 0 || error) && (
            <li>
              <GenerationTimeline events={events} running={running} error={error} />
            </li>
          )}
        </ol>
        <div ref={end} />
      </div>
      <form
        className="border-line border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="card focus-within:border-accent flex flex-col gap-2 p-2">
          <label className="sr-only" htmlFor="chat-input">
            {t('chat.placeholder')}
          </label>
          <textarea
            id="chat-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={3}
            maxLength={1200}
            placeholder={onCode ? t('code.askPlaceholder') : t('chat.placeholder')}
            className="placeholder:text-muted/70 w-full resize-none bg-transparent px-2 py-1 text-[13px] leading-relaxed focus:outline-none"
          />
          <div className="flex items-center justify-end gap-2">
            {onCode && !running && !codeBusy && (
              <button
                type="button"
                disabled={text.trim().length < 4}
                onClick={() => send(true)}
                className="border-line hover:bg-panel-2 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                {t('code.askExplainBtn')}
              </button>
            )}
            {running ? (
              <button
                type="button"
                onClick={cancel}
                className="border-line hover:bg-panel-2 rounded-lg border px-3 py-1.5 text-xs font-medium"
              >
                {t('new.cancel')}
              </button>
            ) : (
              <button
                type="submit"
                disabled={text.trim().length < 4 || codeBusy}
                aria-label={t('chat.send')}
                className="btn-primary focus-visible:outline-accent grid h-8 w-8 place-items-center focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp size={16} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
