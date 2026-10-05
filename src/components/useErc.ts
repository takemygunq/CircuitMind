'use client';

import { useMemo } from 'react';
import { runErc, type ErcReport } from '@/core/erc';
import { useWorkspace } from '@/store/workspace';
import { useBoard } from './useBoard';

/** ERC текущего проекта; пересчитывается при смене проекта или платы. */
export function useErc(): ErcReport | undefined {
  const project = useWorkspace((s) => s.project);
  const { board } = useBoard();
  return useMemo(() => (board ? runErc(project, { board }) : undefined), [project, board]);
}
