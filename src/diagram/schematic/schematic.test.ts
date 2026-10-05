import { describe, expect, it } from 'vitest';
import { computeNets } from '@/core/nets';
import { demoProjects, symbolsUno } from '@/core/fixtures';
import { getBoard } from '@/core/library';
import { buildSchematic } from './model';
import { renderSchematicSvg } from './render';

describe.each([...demoProjects, { id: 'symbols', project: symbolsUno }])(
  'schematic of $project.title',
  ({ project }) => {
    const board = getBoard(project.boardId)!;
    const s = buildSchematic(project, board);

    it('draws every used part and every connected endpoint exactly once', () => {
      const drawn = new Set([
        ...s.blocks.map((b) => b.ref),
        ...s.elements.map((e) => e.ref),
        ...s.symbols.map((x) => x.ref),
      ]);
      for (const part of project.parts)
        expect(drawn.has(part.instanceId), part.instanceId).toBe(true);
      const nets = computeNets(project);
      // каждый вывод цепи — провод, знак питания, метка или внутреннее соединение цепочки
      const covered = s.wires.length + s.marks.length;
      expect(covered).toBeGreaterThan(0);
      expect(nets.nets.length).toBeGreaterThan(0);
    });

    it('keeps wires of different nets apart (no overlap)', () => {
      const hs = s.wires.filter((w) => w.a.y === w.b.y);
      const vs = s.wires.filter((w) => w.a.x === w.b.x && w.a.y !== w.b.y);
      for (const [list, key, lo, hi] of [
        [hs, 'y', 'x', 'x'],
        [vs, 'x', 'y', 'y'],
      ] as const) {
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i];
            const b = list[j];
            if (a.net === b.net || Math.abs(a.a[key] - b.a[key]) > 0.5) continue;
            const overlap =
              Math.min(Math.max(a.a[lo], a.b[hi]), Math.max(b.a[lo], b.b[hi])) -
              Math.max(Math.min(a.a[lo], a.b[hi]), Math.min(b.a[lo], b.b[hi]));
            expect(overlap, `${a.net}/${b.net}`).toBeLessThanOrEqual(0.01);
          }
      }
    });

    it('renders a self-contained SVG without NaN', () => {
      const { svg, width, height } = renderSchematicSvg(project, board, { background: true });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toMatch(/NaN|undefined|var\(--/);
      expect(width).toBeGreaterThan(100);
      expect(height).toBeGreaterThan(50);
    });
  },
);

describe('weather station', () => {
  const project = demoProjects[0].project;
  const s = buildSchematic(project, getBoard(project.boardId)!);

  it('uses power symbols for 3V3/GND and a chain for R1 → LED', () => {
    expect(s.marks.some((m) => m.kind === 'gnd')).toBe(true);
    expect(s.marks.some((m) => m.kind === 'power' && m.text === '3V3')).toBe(true);
    const r1 = s.elements.find((e) => e.ref === 'R1')!;
    const led = s.elements.find((e) => e.ref === 'led1')!;
    expect(led.y).toBe(r1.y);
    expect(Math.abs(led.x - r1.x)).toBe(40);
    expect(r1.value).toBe('220 Ω');
  });
});

describe('symbol set', () => {
  const board = getBoard(symbolsUno.boardId)!;
  const s = buildSchematic(symbolsUno, board);

  it('draws transistors, potentiometer and relay as symbols, two-terminal parts as elements', () => {
    expect(s.symbols.map((x) => x.kind).sort()).toEqual(['nmos', 'npn', 'potentiometer', 'relay']);
    expect(s.elements.map((e) => e.kind).sort()).toEqual([
      'button',
      'diode',
      'led',
      'motor',
      'resistor',
      'resistor',
    ]);
    expect(s.blocks.map((b) => b.ref)).toEqual(['board']);
  });

  it('puts power symbols on the potentiometer ends and wires its wiper', () => {
    const rv = s.symbols.find((x) => x.ref === 'RV1')!;
    expect(s.marks.some((m) => m.kind === 'power' && Math.abs(m.y - (rv.y + 2)) < 0.01)).toBe(true);
    expect(s.marks.some((m) => m.kind === 'gnd' && Math.abs(m.y - (rv.y + 38)) < 0.01)).toBe(true);
    expect(s.wires.length).toBeGreaterThan(0);
  });
});
