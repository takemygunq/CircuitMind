'use client';

import { useMemo, useState } from 'react';
import type { BoardDef } from '@/core/schema';
import { buildSchematic, CSS_PALETTE, renderSchematicInner } from '@/diagram/schematic';
import { useWorkspace } from '@/store/workspace';
import { PartCards } from './PartCards';
import { Viewport } from './Viewport';
import { useT } from './useT';

/** Принципиальная схема: символы деталей, питание и земля — знаками, сигнальные цепи — по отдельным дорожкам. */
export function SchematicView({ board }: { board: BoardDef }) {
  const t = useT();
  const project = useWorkspace((s) => s.project);
  const projectId = useWorkspace((s) => s.projectId);
  const [net, setNet] = useState<string | null>(null);

  const model = useMemo(() => buildSchematic(project, board), [project, board]);
  const inner = useMemo(() => renderSchematicInner(model, CSS_PALETTE), [model]);
  const hoverNet = useWorkspace((s) => s.hoverNet);
  const activeNet = net ?? (hoverNet !== null ? String(hoverNet) : null);
  const bounds = useMemo(
    () => ({ x: -6, y: -4, w: model.width + 6, h: model.height + 8 }),
    [model],
  );

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="relative min-h-[55vh] min-w-0 flex-1 lg:min-h-0">
        <Viewport bounds={bounds} fitKey={`${projectId}|${board.id}|schematic`}>
          {/* подсветка цепи под курсором; стиль вне innerHTML, чтобы наведение не пересоздавало разметку */}
          {activeNet !== null && (
            <style>{`[data-net="${activeNet}"] line, [data-net="${activeNet}"] circle { stroke: var(--accent); } [data-net="${activeNet}"] line { stroke-width: 1.6; } [data-net="${activeNet}"] text { fill: var(--accent); }`}</style>
          )}
          <g
            onPointerOver={(e) => {
              const el = (e.target as Element).closest('[data-net]');
              setNet(el?.getAttribute('data-net') ?? null);
            }}
            onPointerLeave={() => setNet(null)}
            dangerouslySetInnerHTML={{ __html: inner }}
          />
        </Viewport>
        {model.unknownRefs.length > 0 && (
          <p className="bg-warn-bg text-warn-fg absolute top-3 left-3 rounded-md px-3 py-1.5 text-xs">
            {t('schematic.unknown', { refs: model.unknownRefs.join(', ') })}
          </p>
        )}
        <p className="text-muted pointer-events-none absolute right-16 bottom-2 left-3 text-xs">
          {t('schematic.hint')}
        </p>
      </div>
      <aside className="border-line bg-panel flex max-h-full flex-col overflow-hidden border-t lg:w-[26rem] lg:shrink-0 lg:border-t-0 lg:border-l">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <PartCards board={board} />
        </div>
      </aside>
    </div>
  );
}
