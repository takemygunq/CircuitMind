'use client';

import { Play, Square } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { BoardDef } from '@/core/schema';
import { useWorkspace } from '@/store/workspace';
import { DiagramView } from './DiagramView';
import { SimPanel } from './SimPanel';
import { useSim } from './useSim';
import { useT } from './useT';

function RunButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`focus-visible:outline-accent absolute top-4 left-4 z-10 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg transition-colors focus-visible:outline-2 ${on ? 'bg-panel-2 text-fg border-line border' : 'btn-primary'}`}
    >
      {on ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      {on ? t('diagram.simStop') : t('diagram.simRun')}
    </button>
  );
}

/** Диаграмма-карточки; кнопка «Симуляция» запускает расчёт по тем же проводам: ток бежит по кривым, справа — управление. */
export function DiagramTab({ board }: { board: BoardDef }) {
  const simOn = useWorkspace((s) => s.simOn);
  const setSimOn = useWorkspace((s) => s.setSimOn);
  return simOn ? (
    <SimulatedDiagram board={board} onStop={() => setSimOn(false)} />
  ) : (
    <div className="relative min-h-0 min-w-0 flex-1">
      <DiagramView board={board} />
      <RunButton on={false} onClick={() => setSimOn(true)} />
    </div>
  );
}

function SimulatedDiagram({ board, onStop }: { board: BoardDef; onStop: () => void }): ReactNode {
  const sim = useSim(board);
  const [showValues, setShowValues] = useState(false);
  return (
    <>
      <div className="relative min-h-[55vh] min-w-0 flex-1 lg:min-h-0">
        <DiagramView board={board} sim={sim ?? null} />
        <RunButton on onClick={onStop} />
      </div>
      {sim && <SimPanel sim={sim} showValues={showValues} onShowValues={setShowValues} />}
    </>
  );
}
