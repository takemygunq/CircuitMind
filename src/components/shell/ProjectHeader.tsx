'use client';

import { projectTexts } from '@/i18n/library';
import { useWorkspace } from '@/store/workspace';
import { ErcBadge } from '../ErcPanel';
import { ExportMenu } from '../ExportMenu';
import { DeleteProjectButton } from '../SavedProjects';
import { useT } from '../useT';

/** Шапка проекта: название, статус сохранения, ERC, сохранение и экспорт. */
export function ProjectHeader({ refreshSaved }: { refreshSaved: () => Promise<void> }) {
  const t = useT();
  const project = useWorkspace((s) => s.project);
  const projectId = useWorkspace((s) => s.projectId);
  const locale = useWorkspace((s) => s.locale);
  const texts = projectTexts(projectId, project, locale);
  const saveState = useWorkspace((s) => s.saveState);
  const setTab = useWorkspace((s) => s.setTab);
  return (
    <header className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
      <div className="min-w-0">
        <h1 className="truncate text-[15px] font-semibold tracking-tight">{texts.title}</h1>
        <p className="text-muted text-xs">
          {projectId !== 'generated'
            ? t('header.demo')
            : saveState === 'saving'
              ? t('header.saving')
              : saveState === 'failed'
                ? t('header.failed')
                : t('header.autosaved')}
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <ErcBadge onClick={() => setTab('overview')} />
        <DeleteProjectButton onChange={refreshSaved} />
        <ExportMenu />
      </div>
    </header>
  );
}
