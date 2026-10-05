import { describe, expect, it } from 'vitest';
import { roundedPath, routeWire, type Pt, type Rect } from './routing';

const RIGHT = { dx: 1, dy: 0 };
const LEFT = { dx: -1, dy: 0 };

const orthogonal = (pts: Pt[]) =>
  pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y);
const hits = (pts: Pt[], r: Rect) =>
  pts.some((p, i) => {
    if (i === 0) return false;
    const q = pts[i - 1];
    return (
      Math.max(p.x, q.x) > r.x &&
      Math.min(p.x, q.x) < r.x + r.w &&
      Math.max(p.y, q.y) > r.y &&
      Math.min(p.y, q.y) < r.y + r.h
    );
  });

describe('routeWire', () => {
  it('connects endpoints orthogonally', () => {
    const pts = routeWire({ x: 0, y: 0 }, RIGHT, { x: 30, y: 20 }, LEFT, []);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 30, y: 20 });
    expect(orthogonal(pts)).toBe(true);
  });

  it('goes around an obstacle in the way', () => {
    const wall: Rect = { x: 10, y: -20, w: 10, h: 40 };
    const pts = routeWire({ x: 0, y: 0 }, RIGHT, { x: 30, y: 0 }, LEFT, [wall]);
    expect(orthogonal(pts)).toBe(true);
    expect(hits(pts.slice(1, -1), wall)).toBe(false);
  });

  it('routes a left-edge pin around the board to a target on the right', () => {
    const board: Rect = { x: 0, y: 0, w: 28, h: 51 };
    const pts = routeWire({ x: 2.5, y: 10 }, LEFT, { x: 50, y: 10 }, LEFT, [board]);
    expect(hits(pts.slice(1, -1), board)).toBe(false);
  });

  it('separates parallel wires going around the same obstacle with different lanes', () => {
    const wall: Rect = { x: 10, y: -5, w: 10, h: 10 };
    const a = routeWire({ x: 0, y: 0 }, RIGHT, { x: 30, y: 0 }, LEFT, [wall], 0);
    const b = routeWire({ x: 0, y: 0 }, RIGHT, { x: 30, y: 0 }, LEFT, [wall], 3);
    expect(a).not.toEqual(b);
    expect(hits(a.slice(1, -1), wall) || hits(b.slice(1, -1), wall)).toBe(false);
  });
});

describe('roundedPath', () => {
  it('starts and ends at the endpoints and rounds corners', () => {
    const d = roundedPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain('Q 10 0');
    expect(d.endsWith('L 10 10')).toBe(true);
  });
});
