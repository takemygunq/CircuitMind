import { describe, expect, it } from 'vitest';
import { computeNets } from '@/core/nets';
import { demoProjects } from '@/core/fixtures';
import { getBoard } from '@/core/library';
import { layoutParts } from './layout';
import { computeWires } from './project-view';
import { countOverlaps } from './routing';

describe('wires of different nets do not run on top of each other', () => {
  for (const d of demoProjects) {
    it(d.project.title, () => {
      const board = getBoard(d.project.boardId)!;
      const wires = computeWires(
        d.project,
        board,
        layoutParts(d.project, board),
        computeNets(d.project),
      );
      expect(wires.length).toBeGreaterThan(0);
      expect(countOverlaps(wires.map((w) => ({ points: w.points, net: w.netId })))).toBe(0);
    });
  }
});
