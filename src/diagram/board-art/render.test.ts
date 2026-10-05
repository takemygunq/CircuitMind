import { describe, expect, it } from 'vitest';
import { boards } from '@/core/library';
import { lintBoard } from '@/core/library/lint-board';
import type { BoardDef } from '@/core/schema';
import { renderBoardSvg } from './render';

describe.each(boards.map((b) => [b.id, b] as const))('%s', (_id, board) => {
  it('renders valid-looking SVG with every pin', () => {
    const svg = renderBoardSvg(board);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    for (const p of board.pins) expect(svg).toContain(`data-pin="${p.id}"`);
  });

  it('has realistic art and passes board lint', () => {
    expect(board.art?.parts.length).toBeGreaterThan(5);
    expect(lintBoard(board).errors).toEqual([]);
  });
});

describe('renderBoardSvg safety', () => {
  const base = boards[0];

  it('escapes text coming from board data', () => {
    const evil: BoardDef = {
      ...base,
      name: '"><script>alert(1)</script>',
      pins: base.pins.map((p, i) =>
        i === 0 ? { ...p, id: 'X"onmouseover="1', label: '<img src=x onerror=1>' } : p,
      ),
    };
    const svg = renderBoardSvg(evil);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('<img');
    expect(svg).not.toMatch(/"onmouseover=/);
  });

  it('ignores non-hex colors', () => {
    const evil = {
      ...base,
      art: { ...base.art!, pcbColor: 'red" onload="x', silkColor: 'url(#x)' },
    } as BoardDef;
    expect(renderBoardSvg(evil)).not.toContain('onload');
  });

  it('draws a simplified board when art is missing', () => {
    const svg = renderBoardSvg({ ...base, art: undefined });
    expect(svg).toContain('class="pins"');
  });

  it('can omit labels and traces', () => {
    const svg = renderBoardSvg(base, { labels: false, traces: false });
    expect(svg).not.toContain('class="labels"');
    expect(svg).not.toContain('class="traces"');
  });
});
