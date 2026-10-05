import type { BoardDef, ComponentDef, PartInstance, Point, Project } from '@/core/schema';
import { getComponent } from '@/core/library';
import { renderComponentArt, type ComponentArt } from './component-art/render';
import type { Rect } from './routing';

export interface PlacedPart {
  part: PartInstance;
  def: ComponentDef | undefined;
  art: ComponentArt | undefined;
  position: Point;
}

const GAP = 8;
const SNAP = 1.27;
export const snap = (v: number): number => Math.round(v / SNAP) * SNAP;

/**
 * Расставляет детали: заданные в проекте позиции сохраняются (с учётом перетаскивания в `overrides`),
 * остальные укладываются колонкой справа от платы.
 */
export function layoutParts(
  project: Project,
  board: BoardDef,
  overrides: Record<string, Point> = {},
): PlacedPart[] {
  let cursorY = 0;
  const colX = board.size.width + 22; // запас под дорожки проводов между платой и деталями
  return project.parts.map((part) => {
    const def = getComponent(part.componentId);
    const art = def ? renderComponentArt(def, part.value) : undefined;
    let position = overrides[part.instanceId] ?? part.position;
    if (!position) {
      const top = art ? -art.bbox.y : 0;
      position = { x: colX - (art?.bbox.x ?? 0), y: cursorY + top };
      cursorY += (art?.bbox.h ?? 10) + GAP;
    }
    return { part, def, art, position };
  });
}

export const partRect = (p: PlacedPart): Rect | undefined =>
  p.art && {
    x: p.position.x + p.art.bbox.x,
    y: p.position.y + p.art.bbox.y,
    w: p.art.bbox.w,
    h: p.art.bbox.h,
  };

/** Подпись детали ставится со стороны, откуда провода не подходят (чаще всего они входят сверху — подпись снизу). */
export function labelBelow(p: PlacedPart): boolean {
  const exits = Object.values(p.art?.exits ?? {});
  return exits.filter((e) => e.dy < 0).length >= exits.filter((e) => e.dy > 0).length;
}

const LABEL_ZONE = 5; // мм под/над деталью, занятые подписью

/** Корпус детали вместе с зоной подписи: провода обходят и то, и другое. */
export function partObstacle(p: PlacedPart): Rect | undefined {
  const r = partRect(p);
  if (!r) return undefined;
  return labelBelow(p)
    ? { ...r, h: r.h + LABEL_ZONE }
    : { ...r, y: r.y - LABEL_ZONE, h: r.h + LABEL_ZONE };
}

export const boardRect = (board: BoardDef): Rect => ({
  x: 0,
  y: 0,
  w: board.size.width,
  h: board.size.height,
});

/** Граница всей сцены (плата + детали) для «вписать в экран». */
export function sceneBounds(board: BoardDef, placed: PlacedPart[]): Rect {
  const rects = [boardRect(board), ...placed.map(partRect).filter((r): r is Rect => !!r)];
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Направление выхода провода у пина платы: к ближайшему краю. */
export function boardPinExit(board: BoardDef, pin: Point): { dx: number; dy: number } {
  const d = [
    { v: pin.x, dx: -1, dy: 0 },
    { v: board.size.width - pin.x, dx: 1, dy: 0 },
    { v: pin.y, dx: 0, dy: -1 },
    { v: board.size.height - pin.y, dx: 0, dy: 1 },
  ].sort((a, b) => a.v - b.v)[0];
  return { dx: d.dx, dy: d.dy };
}

/** Длина выхода провода у пина платы: до края платы + зазор, чтобы повороты не касались корпуса. */
export function boardPinStub(
  board: BoardDef,
  pin: Point,
  exit: { dx: number; dy: number },
): number {
  const edge =
    exit.dx < 0
      ? pin.x
      : exit.dx > 0
        ? board.size.width - pin.x
        : exit.dy < 0
          ? pin.y
          : board.size.height - pin.y;
  return edge + 2.2;
}
