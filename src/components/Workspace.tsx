'use client';

import { useEffect } from 'react';
import { ChatPanel } from './ChatPanel';
import { ProjectHeader } from './shell/ProjectHeader';
import { Sidebar } from './shell/Sidebar';
import { ViewsPanel } from './shell/ViewsPanel';
import { DiagramTab } from './DiagramTab';
import { PartsCatalogue } from './PartsCatalogue';
import { ProjectOverview } from './ProjectOverview';
import { Inventory } from '@/core/inventory';
import { LOCALES, type Locale } from '@/i18n';
import {
  CODE_STORAGE_KEY,
  INVENTORY_STORAGE_KEY,
  OWNED_STORAGE_KEY,
  PROJECT_TABS,
  useWorkspace,
  type Theme,
} from '@/store/workspace';
import { CodeView } from './CodeView';
import { EmulatorProvider } from './EmulatorProvider';
import { NewProjectView } from './NewProjectView';
import { useAutosave, useSavedList } from './SavedProjects';
import { ProvidersSettings } from './ProvidersSettings';
import { SchematicView } from './SchematicView';
import { PinoutPage } from './PinoutPage';
import { useBoard } from './useBoard';
import { useT } from './useT';

export function Workspace() {
  const t = useT();
  const {
    tab,
    locale,
    setLocale,
    theme,
    setTheme,
    loadOwned,
    loadCode,
    loadInventory,
    settingsOpen,
    setSettingsOpen,
    project,
  } = useWorkspace();
  const refreshSaved = useSavedList();
  useAutosave(refreshSaved);
  const setCatalogueLinks = useWorkspace((s) => s.setCatalogueLinks);
  useEffect(() => {
    fetch('/api/catalogue/links')
      .then((r) => (r.ok ? r.json() : {}))
      .then(setCatalogueLinks)
      .catch(() => undefined);
  }, [setCatalogueLinks]);
  const { board, loading } = useBoard();

  // Тема и язык: читаем сохранённое после гидратации, чтобы разметка сервера и клиента совпала
  useEffect(() => {
    try {
      // возврат с OpenRouter OAuth: сразу открываем настройки
      if (new URLSearchParams(window.location.search).has('openrouter')) setSettingsOpen(true);
      const th = localStorage.getItem('cm-theme-v2') as Theme | null;
      const lo = localStorage.getItem('cm-locale') as Locale | null;
      const system: Theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      setTheme(th ?? 'dark');
      void system;
      if (lo && LOCALES.some((l) => l.id === lo)) setLocale(lo);
      const owned: unknown = JSON.parse(localStorage.getItem(OWNED_STORAGE_KEY) ?? 'null');
      if (owned && typeof owned === 'object' && !Array.isArray(owned)) {
        const clean = Object.fromEntries(
          Object.entries(owned).filter(
            ([, v]) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
          ),
        ) as Record<string, string[]>;
        loadOwned(clean);
      }
      const inv = Inventory.safeParse(
        JSON.parse(localStorage.getItem(INVENTORY_STORAGE_KEY) ?? 'null'),
      );
      if (inv.success) loadInventory(inv.data);
      const code: unknown = JSON.parse(localStorage.getItem(CODE_STORAGE_KEY) ?? 'null');
      if (code && typeof code === 'object' && !Array.isArray(code)) {
        loadCode(
          Object.fromEntries(
            Object.entries(code).filter(([, v]) => typeof v === 'string'),
          ) as Record<string, string>,
        );
      }
    } catch {
      /* localStorage недоступен или повреждён — остаёмся на значениях по умолчанию */
    }
  }, [setTheme, setLocale, loadOwned, loadCode, loadInventory, setSettingsOpen]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.lang = locale;
    document.title = `${t('app.title')} — ${t('app.subtitle')}`;
    try {
      localStorage.setItem('cm-theme-v2', theme);
      localStorage.setItem('cm-locale', locale);
    } catch {
      /* ignore */
    }
  }, [theme, locale, t]);

  const isProjectTab = PROJECT_TABS.includes(tab);
  const page = settingsOpen ? 'settings' : isProjectTab ? 'project' : tab;

  return (
    <EmulatorProvider board={board}>
      <div className="bg-bg flex h-dvh">
        <Sidebar />
        {page === 'settings' ? (
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <ProvidersSettings />
          </main>
        ) : page === 'new' ? (
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <NewProjectView />
          </main>
        ) : page === 'parts' ? (
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <PartsCatalogue />
          </main>
        ) : (
          <>
            <ChatPanel />
            <div className="flex min-w-0 flex-1 flex-col">
              <ProjectHeader refreshSaved={refreshSaved} />
              <main className="flex min-h-0 flex-1 flex-col lg:flex-row" role="tabpanel">
                {!board ? (
                  <div className="text-muted flex flex-1 items-center justify-center p-6 text-sm">
                    {loading ? t('common.loading') : t('board.missing', { id: project.boardId })}
                  </div>
                ) : tab === 'diagram' ? (
                  <DiagramTab board={board} />
                ) : tab === 'schematic' ? (
                  <div className="min-h-0 min-w-0 flex-1">
                    <SchematicView board={board} />
                  </div>
                ) : tab === 'code' ? (
                  <div className="min-h-0 min-w-0 flex-1">
                    <CodeView board={board} />
                  </div>
                ) : tab === 'overview' ? (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <ProjectOverview board={board} />
                  </div>
                ) : (
                  <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                    <PinoutPage board={board} />
                  </div>
                )}
              </main>
            </div>
            <ViewsPanel />
          </>
        )}
      </div>
    </EmulatorProvider>
  );
}
