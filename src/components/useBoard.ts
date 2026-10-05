'use client';

import { useEffect, useState } from 'react';
import { BoardDef } from '@/core/schema';
import { selectBoard, useWorkspace } from '@/store/workspace';

/** Плата текущего проекта; сгенерированные ИИ платы подгружаются из /api/boards/:id. */
export function useBoard(): { board: BoardDef | undefined; loading: boolean } {
  const board = useWorkspace(selectBoard);
  const boardId = useWorkspace((s) => s.project.boardId);
  const cacheBoard = useWorkspace((s) => s.cacheBoard);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (board || failed === boardId) return;
    let alive = true;
    fetch(`/api/boards/${encodeURIComponent(boardId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        const parsed = BoardDef.safeParse(d.board);
        if (!alive) return;
        if (parsed.success) cacheBoard(parsed.data);
        else setFailed(boardId);
      })
      .catch(() => alive && setFailed(boardId));
    return () => {
      alive = false;
    };
  }, [board, boardId, failed, cacheBoard]);

  return { board, loading: !board && failed !== boardId };
}
