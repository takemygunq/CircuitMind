import { describe, expect, it } from 'vitest';
import { getBoard } from '@/core/library';
import { demoProjects, weatherEsp32 } from '@/core/fixtures';
import { computeNets } from '@/core/nets';
import { boardPinUsage, computeWires, netVoltage, peersOf, resolveEndpoint } from './project-view';
import { boardRect, layoutParts, partRect } from './layout';

const board = getBoard('esp32-devkit-v1')!;
const placed = layoutParts(weatherEsp32, board);
const byId = new Map(placed.map((p) => [p.part.instanceId, p]));
const nets = computeNets(weatherEsp32);

describe('resolveEndpoint', () => {
  it('resolves board pins and part pins to world coordinates', () => {
    const b = resolveEndpoint('board:GPIO4', board, byId);
    expect(b.pin?.id).toBe('GPIO4');
    expect(b.position).toEqual(b.pin!.position);
    const d = resolveEndpoint('dht1:DATA', board, byId);
    expect(d.position).toEqual({ x: 54 + 2.54, y: 8 });
    expect(d.owner).toContain('DHT22');
  });
  it('returns no position for unknown pins', () => {
    expect(resolveEndpoint('dht1:NOPE', board, byId).position).toBeUndefined();
  });
});

describe('computeWires', () => {
  const wires = computeWires(weatherEsp32, board, placed, nets);
  it('routes every connection orthogonally between its endpoints', () => {
    expect(wires).toHaveLength(weatherEsp32.connections.length);
    for (const w of wires) {
      expect(w.points[0]).toEqual(w.from.position);
      expect(w.points[w.points.length - 1]).toEqual(w.to.position);
      w.points.forEach((p, i) => {
        if (i) expect(p.x === w.points[i - 1].x || p.y === w.points[i - 1].y).toBe(true);
      });
    }
  });
  it('colours wires from the project', () => {
    expect(wires.find((w) => w.from.endpoint === 'board:3V3')!.color).toBe('#e63946');
    expect(wires.find((w) => w.from.endpoint === 'board:GND2')!.color).toBe('#2b2d31');
  });
});

describe('wire routing on demo projects', () => {
  it.each(demoProjects.map((d) => [d.id, d.project] as const))(
    '%s: no wire crosses a part or the board body',
    (_id, project) => {
      const b = getBoard(project.boardId)!;
      const parts = layoutParts(project, b);
      const obstacles = [boardRect(b), ...parts.map(partRect)].filter(
        (r): r is NonNullable<typeof r> => !!r,
      );
      const ns = computeNets(project);
      const stubless = (pts: { x: number; y: number }[]) => pts.slice(1, -1); // первый/последний отрезок — выход из пина
      for (const w of computeWires(project, b, parts, ns)) {
        const pts = stubless(w.points);
        for (let i = 1; i < pts.length; i++)
          for (const o of obstacles) {
            const hit =
              Math.max(pts[i].x, pts[i - 1].x) > o.x &&
              Math.min(pts[i].x, pts[i - 1].x) < o.x + o.w &&
              Math.max(pts[i].y, pts[i - 1].y) > o.y &&
              Math.min(pts[i].y, pts[i - 1].y) < o.y + o.h;
            expect(hit, `wire ${w.from.endpoint} -> ${w.to.endpoint}`).toBe(false);
          }
      }
    },
  );
});

describe('net helpers', () => {
  it('derives net voltage from the board power pin', () => {
    const net3v3 = nets.nets.find((n) => n.name === '3V3')!;
    expect(netVoltage(net3v3, board, byId)).toBe(3.3);
    expect(
      netVoltage(
        nets.nets.find((n) => n.name === 'GND')!,
        board,
        byId,
      ),
    ).toBe(0);
    expect(
      netVoltage(
        nets.nets.find((n) => n.name === 'DHT_DATA')!,
        board,
        byId,
      ),
    ).toBeUndefined();
  });
  it('lists who each board pin talks to', () => {
    const usage = boardPinUsage(nets);
    expect(usage.get('GPIO4')).toEqual(['dht1:DATA', 'Rpu:2']);
    expect(usage.get('GPIO21')).toEqual(['oled1:SDA']);
    expect(usage.has('GPIO5')).toBe(false);
  });
  it('finds peers of an endpoint', () => {
    expect(peersOf('Rpu:2', nets).sort()).toEqual(['board:GPIO4', 'dht1:DATA']);
  });
});

describe('layoutParts', () => {
  it('keeps given positions, applies overrides, and places the rest to the right of the board', () => {
    const moved = layoutParts(weatherEsp32, board, { dht1: { x: 1, y: 2 } });
    expect(moved.find((p) => p.part.instanceId === 'dht1')!.position).toEqual({ x: 1, y: 2 });
    const auto = layoutParts(
      {
        ...weatherEsp32,
        parts: weatherEsp32.parts.map(({ position, ...p }) => (void position, p)),
      },
      board,
    );
    const rects = auto.map(partRect);
    for (const r of rects) expect(r!.x).toBeGreaterThan(board.size.width);
    for (let i = 1; i < rects.length; i++)
      expect(rects[i]!.y).toBeGreaterThanOrEqual(rects[i - 1]!.y + rects[i - 1]!.h);
  });
});
