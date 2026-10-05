import type { Dir } from './component-art/render';

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const STUB = 2.6; // мм: выход провода из пина перед поворотом (по умолчанию)
const PAD = 0.4; // зазор до препятствий

function segHitsRect(p: Pt, q: Pt, r: Rect): boolean {
  const x0 = Math.min(p.x, q.x);
  const x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y);
  const y1 = Math.max(p.y, q.y);
  return x1 > r.x - PAD && x0 < r.x + r.w + PAD && y1 > r.y - PAD && y0 < r.y + r.h + PAD;
}

function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    if (
      (Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6) ||
      (Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6)
    )
      out.splice(i, 1);
  }
  return out;
}

const length = (pts: Pt[]) =>
  pts.reduce(
    (s, p, i) => (i ? s + Math.abs(p.x - pts[i - 1].x) + Math.abs(p.y - pts[i - 1].y) : 0),
    0,
  );

function dot(p: Pt, q: Pt, d: Dir): number {
  return Math.sign(q.x - p.x) * d.dx + Math.sign(q.y - p.y) * d.dy;
}

/**
 * Ортогональный маршрут провода между двумя пинами. Выходит из пина по направлению `da`/`db`,
 * перебирает несколько форм (L, Z, обход по каналам вокруг препятствий) и выбирает самую короткую
 * без пересечений с `obstacles` (корпуса платы и деталей). `lane` разводит параллельные провода.
 */
export function routeWire(
  a: Pt,
  da: Dir,
  b: Pt,
  db: Dir,
  obstacles: Rect[],
  lane = 0,
  stubA = STUB,
  stubB = STUB,
): Pt[] {
  const a1 = { x: a.x + da.dx * stubA, y: a.y + da.dy * stubA };
  const b1 = { x: b.x + db.dx * stubB, y: b.y + db.dy * stubB };
  const off = (lane % 7) * 0.9;

  const ys = new Set<number>([
    (a1.y + b1.y) / 2 + off - 2.7,
    Math.min(a1.y, b1.y) - 2 - off,
    Math.max(a1.y, b1.y) + 2 + off,
  ]);
  const xs = new Set<number>([
    (a1.x + b1.x) / 2 + off - 2.7,
    Math.min(a1.x, b1.x) - 2 - off,
    Math.max(a1.x, b1.x) + 2 + off,
  ]);
  for (const o of obstacles) {
    ys.add(o.y - 1.6 - off);
    ys.add(o.y + o.h + 1.6 + off);
    xs.add(o.x - 1.6 - off);
    xs.add(o.x + o.w + 1.6 + off);
  }

  const candidates: Pt[][] = [
    [a1, { x: b1.x, y: a1.y }, b1],
    [a1, { x: a1.x, y: b1.y }, b1],
    ...[...ys].map((m) => [a1, { x: a1.x, y: m }, { x: b1.x, y: m }, b1]),
    ...[...xs].map((m) => [a1, { x: m, y: a1.y }, { x: m, y: b1.y }, b1]),
  ];

  let best: Pt[] = candidates[0];
  let bestScore = Infinity;
  for (const cand of candidates) {
    const pts = simplify(cand);
    let score = length(pts) + (pts.length - 2) * 1.5;
    for (let i = 0; i < pts.length - 1; i++)
      for (const o of obstacles) if (segHitsRect(pts[i], pts[i + 1], o)) score += 1000;
    if (pts.length > 1) {
      if (dot(a1, pts[1], da) < 0) score += 60;
      if (dot(b1, pts[pts.length - 2], db) < 0) score += 60;
    }
    if (score < bestScore) {
      bestScore = score;
      best = pts;
    }
  }
  return simplify([a, ...best, b]);
}

/** Путь SVG со скруглёнными углами. */
export function roundedPath(pts: Pt[], radius = 1.2): string {
  if (pts.length < 2) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const q = pts[i + 1];
    const r = Math.min(
      radius,
      (Math.abs(c.x - p.x) + Math.abs(c.y - p.y)) / 2,
      (Math.abs(q.x - c.x) + Math.abs(q.y - c.y)) / 2,
    );
    const ux = Math.sign(c.x - p.x);
    const uy = Math.sign(c.y - p.y);
    const vx = Math.sign(q.x - c.x);
    const vy = Math.sign(q.y - c.y);
    d += ` L ${f(c.x - ux * r)} ${f(c.y - uy * r)} Q ${f(c.x)} ${f(c.y)} ${f(c.x + vx * r)} ${f(c.y + vy * r)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${f(last.x)} ${f(last.y)}`;
}

// ───────── разведение параллельных проводов ─────────

/** Расстояние между соседними параллельными проводами, мм. */
export const TRACK_GAP = 1.6;
const MIN_STUB = 1.5; // провод не должен «втягиваться» обратно в пин

export interface Route {
  points: Pt[];
  net: number;
}

const horizontal = (a: Pt, b: Pt) => Math.abs(a.y - b.y) < 1e-6;

/** Пересечения отрезка с препятствиями (первый и последний отрезки у пинов не проверяем — они стартуют внутри корпуса). */
function clearOfObstacles(pts: Pt[], obstacles: Rect[]): boolean {
  for (let i = 1; i < pts.length - 2; i++)
    for (const o of obstacles) if (segHitsRect(pts[i], pts[i + 1], o)) return false;
  return true;
}

/** Концевые участки у пинов остаются в своём направлении и не короче MIN_STUB. */
function stubsOk(before: Pt[], after: Pt[]): boolean {
  const len = (p: Pt[], i: number) => Math.abs(p[i + 1].x - p[i].x) + Math.abs(p[i + 1].y - p[i].y);
  const sgn = (p: Pt[], i: number) => [
    Math.sign(p[i + 1].x - p[i].x),
    Math.sign(p[i + 1].y - p[i].y),
  ];
  const n = after.length - 1;
  for (const i of [0, n - 1]) {
    if (len(after, i) < MIN_STUB) return false;
    const a = sgn(before, i);
    const b = sgn(after, i);
    if (a[0] !== b[0] || a[1] !== b[1]) return false;
  }
  return true;
}

interface SegRef {
  route: number;
  i: number; // отрезок points[i]→points[i+1]
  h: boolean;
  coord: number;
  lo: number;
  hi: number;
  /** Первый и последний отрезки привязаны к пинам и не двигаются. */
  movable: boolean;
}

function segmentsOf(routes: Route[]): SegRef[] {
  const out: SegRef[] = [];
  routes.forEach((r, route) => {
    const n = r.points.length;
    for (let i = 0; i < n - 1; i++) {
      const a = r.points[i];
      const b = r.points[i + 1];
      const h = horizontal(a, b);
      out.push({
        route,
        i,
        h,
        coord: h ? a.y : a.x,
        lo: Math.min(h ? a.x : a.y, h ? b.x : b.y),
        hi: Math.max(h ? a.x : a.y, h ? b.x : b.y),
        movable: i > 0 && i < n - 2,
      });
    }
  });
  return out;
}

const SAME_TRACK = TRACK_GAP - 0.01;
const overlapsInRange = (a: SegRef, b: SegRef) =>
  Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 0.05;
const touching = (a: SegRef, b: SegRef) =>
  a.h === b.h &&
  a.route !== b.route &&
  Math.abs(a.coord - b.coord) < SAME_TRACK &&
  overlapsInRange(a, b);

/**
 * Разводит наложившиеся параллельные участки проводов по соседним «дорожкам» с шагом TRACK_GAP.
 * Двигаются только внутренние отрезки (концы у пинов остаются на месте); новый путь не должен
 * задевать препятствия, а дорожка — быть занятой другим проводом. Провода одной цепи тоже разводятся.
 */
export function nudgeRoutes(routes: Route[], obstacles: Rect[]): Route[] {
  const out = routes.map((r) => ({ ...r, points: r.points.map((p) => ({ ...p })) }));
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    // порядок обработки: от длинных к коротким — короткие отрезки легче подвинуть
    const initial = segmentsOf(out)
      .filter((s) => s.movable)
      .sort((x, y) => y.hi - y.lo - (x.hi - x.lo));
    for (const seg of initial) {
      // положение могло измениться из-за соседей: берём актуальный отрезок
      const all = segmentsOf(out);
      const cur = all.find((s) => s.route === seg.route && s.i === seg.i)!;
      if (!all.some((o) => touching(cur, o))) continue;
      const pts = out[cur.route].points;
      for (let step = 1; step <= 12; step++) {
        let done = false;
        for (const sign of [1, -1]) {
          const c = cur.coord + sign * step * TRACK_GAP;
          const probe = { ...cur, coord: c };
          if (all.some((o) => touching(probe, o))) continue;
          const trial = pts.map((p) => ({ ...p }));
          if (cur.h) trial[cur.i].y = trial[cur.i + 1].y = c;
          else trial[cur.i].x = trial[cur.i + 1].x = c;
          if (!clearOfObstacles(trial, obstacles) || !stubsOk(pts, trial)) continue;
          out[cur.route].points = trial;
          moved = done = true;
          break;
        }
        if (done) break;
      }
    }
    if (!moved) break;
  }
  return out;
}

/** Пары проводов, идущих вплотную друг к другу на внутренних участках. */
export function overlapPairs(routes: Route[]): [number, number][] {
  const segs = segmentsOf(routes).filter((s) => s.movable);
  const out: [number, number][] = [];
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++)
      if (touching(segs[i], segs[j])) out.push([segs[i].route, segs[j].route]);
  return out;
}

export const countOverlaps = (routes: Route[]): number => overlapPairs(routes).length;
