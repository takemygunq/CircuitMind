'use client';

import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { demoProjects } from '@/core/fixtures';
import type { Project } from '@/core/schema';
import type { SavedMeta } from '@/server/projects/store';
import { GENERATED_ID, useWorkspace } from '@/store/workspace';
import { useT } from './useT';

/** Список сохранённых проектов сервера; без доступа (не localhost) остаётся пустым. */
export function useSavedList() {
  const setSaved = useWorkspace((s) => s.setSaved);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/saved');
      if (res.ok) setSaved(((await res.json()) as { projects: SavedMeta[] }).projects);
    } catch {
      /* сервер недоступен — список остаётся прежним */
    }
  }, [setSaved]);
  useEffect(() => {
    // загрузка списка при старте
    void refresh();
  }, [refresh]);
  return refresh;
}

export async function openSaved(id: string): Promise<{ project: Project } | null> {
  const res = await fetch(`/api/saved/${id}`);
  return res.ok ? ((await res.json()) as { project: Project }) : null;
}

/**
 * Автосохранение: любой проект «Мой проект» (созданный ИИ, изменённый чатом, импортированный или открытый из списка)
 * через короткую паузу после изменения записывается на сервер. Демо-проекты не трогаем, пока их не изменили:
 * первое изменение создаёт сохранённую копию.
 */
export function useAutosave(refresh: () => Promise<void>) {
  const project = useWorkspace((s) => s.project);
  const projectId = useWorkspace((s) => s.projectId);
  const savedId = useWorkspace((s) => s.savedId);
  const setSavedId = useWorkspace((s) => s.setSavedId);
  const setSaveState = useWorkspace((s) => s.setSaveState);
  const last = useRef('');

  useEffect(() => {
    if (projectId !== GENERATED_ID) return;
    const body = JSON.stringify(project);
    if (last.current === `${savedId}|${body}`) return;
    setSaveState('saving');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/saved', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project, id: savedId ?? undefined }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { saved } = (await res.json()) as { saved: SavedMeta };
        last.current = `${saved.id}|${body}`;
        if (saved.id !== savedId) setSavedId(saved.id);
        setSaveState('saved');
        void refresh();
      } catch {
        setSaveState('failed');
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [project, projectId, savedId, setSavedId, setSaveState, refresh]);
}

/** Удаляет сохранённый проект с сервера и возвращает в демо-проект. */
export function DeleteProjectButton({ onChange }: { onChange: () => void }) {
  const t = useT();
  const savedId = useWorkspace((s) => s.savedId);
  const setProject = useWorkspace((s) => s.setProject);
  const setSavedId = useWorkspace((s) => s.setSavedId);
  const setTab = useWorkspace((s) => s.setTab);
  if (!savedId) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch(`/api/saved/${savedId}`, { method: 'DELETE' }).catch(() => undefined);
        setProject(demoProjects[0].id);
        setSavedId(null);
        setTab('new');
        onChange();
      }}
      title={t('save.delete')}
      aria-label={t('save.delete')}
      className="border-line bg-panel text-muted hover:text-danger hover:bg-panel-2 focus-visible:outline-accent grid h-8 w-8 place-items-center rounded-lg border focus-visible:outline-2"
    >
      <Trash2 size={15} />
    </button>
  );
}
