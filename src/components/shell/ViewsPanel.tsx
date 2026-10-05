'use client';

import { CircuitBoard, FileCode2, LayoutList, Table2, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';
import { useWorkspace, type TabId } from '@/store/workspace';
import { useT } from '../useT';

function Item({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active?: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`focus-visible:outline-accent flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors focus-visible:outline-2 ${active ? 'bg-panel-2 text-fg font-medium' : 'text-muted hover:bg-panel-2/60 hover:text-fg'}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="eyebrow !text-[10px]">{hint}</span>}
    </button>
  );
}

/** Правая панель «Виды»: диаграмма, распиновка, схема, обзор и код — вместо вкладок. */
export function ViewsPanel() {
  const t = useT();
  const tab = useWorkspace((s) => s.tab);
  const setTab = useWorkspace((s) => s.setTab);
  const views: { id: TabId; icon: ReactNode; label: string }[] = [
    { id: 'diagram', icon: <Workflow size={15} />, label: t('tab.diagram') },
    { id: 'pinout', icon: <Table2 size={15} />, label: t('tab.pinout') },
    { id: 'schematic', icon: <CircuitBoard size={15} />, label: t('tab.schematic') },
    { id: 'overview', icon: <LayoutList size={15} />, label: t('tab.overview') },
  ];
  return (
    <aside className="border-line bg-panel/60 hidden w-56 shrink-0 flex-col gap-5 overflow-y-auto border-l p-3 backdrop-blur xl:flex">
      <div className="px-1.5 pt-1">
        <p className="text-[13px] font-semibold">{t('views.project')}</p>
        <p className="text-muted text-xs">{t('views.sub')}</p>
      </div>
      <section aria-label={t('views.views')}>
        <p className="eyebrow px-1.5 pb-2">{t('views.views')}</p>
        {views.map((v) => (
          <Item
            key={v.id}
            active={tab === v.id}
            onClick={() => setTab(v.id)}
            icon={v.icon}
            label={v.label}
          />
        ))}
      </section>
      <section aria-label={t('views.files')}>
        <p className="eyebrow px-1.5 pb-2">{t('views.files')}</p>
        <Item
          active={tab === 'code'}
          onClick={() => setTab('code')}
          icon={<FileCode2 size={15} />}
          label={t('views.firmware')}
          hint="build"
        />
      </section>
    </aside>
  );
}
