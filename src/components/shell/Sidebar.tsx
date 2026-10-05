'use client';

import { Cable, Cpu, Moon, Plus, Sparkles, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { demoProjects } from '@/core/fixtures';
import { LOCALES, type Locale } from '@/i18n';
import { projectTexts } from '@/i18n/library';
import { GENERATED_ID, PROJECT_TABS, useWorkspace } from '@/store/workspace';
import { openSaved } from '../SavedProjects';
import { useT } from '../useT';
import { Logo } from './Logo';

function NavButton({
  active,
  onClick,
  icon,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`focus-visible:outline-accent flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors focus-visible:outline-2 ${active ? 'bg-panel-2 text-fg font-medium' : 'text-muted hover:bg-panel-2/60 hover:text-fg'}`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

/** Левая панель как в референсе: логотип, «Новый проект», список проектов и раздел «Рабочее пространство». */
export function Sidebar() {
  const t = useT();
  const {
    tab,
    setTab,
    projectTab,
    projectId,
    savedId,
    saved,
    generated,
    setProject,
    setGenerated,
    settingsOpen,
    setSettingsOpen,
    theme,
    setTheme,
    locale,
    setLocale,
  } = useWorkspace();

  const openProject = () => setTab(PROJECT_TABS.includes(projectTab) ? projectTab : 'diagram');
  const inProject = !settingsOpen && PROJECT_TABS.includes(tab);
  const activeSaved = projectId === GENERATED_ID ? savedId : null;

  return (
    <aside
      className="border-line bg-panel/60 flex w-60 shrink-0 flex-col border-r backdrop-blur"
      aria-label={t('app.title')}
    >
      <div className="flex items-center px-4 pt-4 pb-3">
        <button
          type="button"
          onClick={() => setTab('new')}
          aria-label={t('app.title')}
          className="focus-visible:outline-accent rounded-lg focus-visible:outline-2"
        >
          <Logo word size={26} />
        </button>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => setTab('new')}
          className={`btn-primary focus-visible:outline-accent flex w-full items-center justify-center gap-2 px-3 py-2 text-[13px] focus-visible:outline-2 ${!settingsOpen && tab === 'new' ? 'ring-accent/40 ring-2' : ''}`}
        >
          <Plus size={15} strokeWidth={2.4} />
          {t('sidebar.newProject')}
        </button>
      </div>

      <p className="eyebrow px-4 pt-5 pb-2">{t('sidebar.projects')}</p>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" aria-label={t('sidebar.projects')}>
        <ul className="flex flex-col gap-0.5">
          {generated && !savedId && (
            <li>
              <NavButton
                active={inProject && projectId === GENERATED_ID}
                onClick={() => (setProject(GENERATED_ID), openProject())}
                icon={<Sparkles size={14} className="text-accent shrink-0" />}
              >
                {generated.title}
              </NavButton>
            </li>
          )}
          {saved.map((s) => (
            <li key={s.id}>
              <NavButton
                active={inProject && activeSaved === s.id}
                onClick={async () => {
                  const found = await openSaved(s.id);
                  if (found) {
                    setGenerated(found.project, false, s.id);
                    openProject();
                  }
                }}
                icon={<span className="bg-accent/70 h-1.5 w-1.5 shrink-0 rounded-full" />}
              >
                {s.title}
              </NavButton>
            </li>
          ))}
          {demoProjects.map((d) => (
            <li key={d.id}>
              <NavButton
                active={inProject && projectId === d.id}
                onClick={() => (setProject(d.id), openProject())}
                icon={<span className="bg-muted/50 h-1.5 w-1.5 shrink-0 rounded-full" />}
              >
                {projectTexts(d.id, d.project, locale).title}
              </NavButton>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-line border-t px-3 py-3">
        <p className="eyebrow px-1.5 pb-2">{t('sidebar.workspace')}</p>
        <NavButton
          active={!settingsOpen && tab === 'parts'}
          onClick={() => setTab('parts')}
          icon={<Cable size={15} />}
        >
          {t('tab.parts')}
        </NavButton>
        <NavButton
          active={settingsOpen}
          onClick={() => setSettingsOpen(!settingsOpen)}
          icon={<Cpu size={15} />}
        >
          {t('app.settings')}
        </NavButton>
        <div className="mt-2 flex items-center gap-1.5 px-1">
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? t('theme.light') : t('theme.dark')}
            title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
            className="text-muted hover:text-fg hover:bg-panel-2 focus-visible:outline-accent grid h-8 w-8 place-items-center rounded-lg focus-visible:outline-2"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <label className="sr-only" htmlFor="lang">
            {t('app.language')}
          </label>
          <select
            id="lang"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            className="text-muted hover:text-fg focus-visible:outline-accent cursor-pointer rounded-lg bg-transparent px-2 py-1 font-mono text-[11px] uppercase focus-visible:outline-2"
          >
            {LOCALES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </aside>
  );
}
