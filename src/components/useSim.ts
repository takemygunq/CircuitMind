'use client';

import { useMemo } from 'react';
import { defaultSimState, simulate, type SimResult, type SimState } from '@/core/sim';
import type { BoardDef } from '@/core/schema';
import { useWorkspace } from '@/store/workspace';

export interface SimBundle {
  board: BoardDef;
  state: SimState;
  result: SimResult;
}

/** Состояние симуляции (умолчания + ручные переключатели) и результат расчёта. Пересчитывается при каждом изменении. */
export function useSim(board: BoardDef | undefined): SimBundle | undefined {
  const project = useWorkspace((s) => s.project);
  const simGpio = useWorkspace((s) => s.simGpio);
  const simDuty = useWorkspace((s) => s.simDuty);
  const simPressed = useWorkspace((s) => s.simPressed);
  const simPots = useWorkspace((s) => s.simPots);
  return useMemo(() => {
    if (!board) return undefined;
    const base = defaultSimState(project, board);
    const state: SimState = {
      gpio: {
        ...base.gpio,
        ...Object.fromEntries(Object.entries(simGpio).filter(([pin]) => pin in base.gpio)),
      },
      pressed: simPressed,
      pots: simPots,
      duty: simDuty,
    };
    return { board, state, result: simulate(project, board, state) };
  }, [project, board, simGpio, simDuty, simPressed, simPots]);
}
