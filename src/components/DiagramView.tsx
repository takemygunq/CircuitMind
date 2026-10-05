'use client';

import { useMemo } from 'react';
import { getComponent } from '@/core/library';
import { computeNets } from '@/core/nets';
import { BOARD_REF, parseEndpoint, type BoardDef } from '@/core/schema';
import { flowSeconds, formatCurrent } from '@/core/sim';
import { renderBoardInner } from '@/diagram/board-art/render';
import { adaptWire, wireColor } from '@/diagram/colors';
import { renderComponentArt } from '@/diagram/component-art/render';
import { componentName } from '@/i18n/library';
import { useWorkspace } from '@/store/workspace';
import type { SimBundle } from './useSim';
import { Viewport } from './Viewport';
import { useT } from './useT';

// Компактные карточки: фото слева, название справа, ниже строки выводов.
const PART_W = 252;
const BOARD_W = 300;
const HEAD_H = 68;
const ROW_H = 27;
const GAP_Y = 22;
const COL_GAP = 150; // между колонками деталей
const BOARD_GAP = 230; // между платой и ближайшей колонкой
const MIN_COL_H = 720; // колонка выше этого переносится в следующую
const ART = 48;

interface Row {
  id: string;
  label: string;
  y: number;
}
type Side = 'left' | 'right';
interface Card {
  ref: string;
  title: string;
  subtitle: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rows: Row[];
  art: string;
  /** Ключ связи с каталогом: "board:<id>" или "component:<id>". */
  linkKey: string;
  /** С какой стороны от платы стоит карточка; у самой платы — null. */
  side: Side | null;
  board: boolean;
}

function fitArt(inner: string, w: number, h: number, ox = 0, oy = 0): string {
  const k = Math.min(ART / w, ART / h);
  const tx = 10 + (ART - w * k) / 2;
  const ty = 10 + (ART - h * k) / 2;
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(4)}) translate(${-ox} ${-oy})">${inner}</g>`;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Диаграмма-«карточки». Плата в центре, детали по обе стороны: ближе к плате — те, что связаны с её верхними пинами;
 * стороны уравновешены по высоте, а когда колонка выходит выше экрана, деталь переносится в следующую колонку наружу.
 * Так схема растёт вширь, а не бесконечно вниз.
 */
export function DiagramView({ board, sim = null }: { board: BoardDef; sim?: SimBundle | null }) {
  const t = useT();
  const project = useWorkspace((s) => s.project);
  const projectId = useWorkspace((s) => s.projectId);
  const dark = useWorkspace((s) => s.theme) === 'dark';
  const locale = useWorkspace((s) => s.locale);
  const wc = (c: string) => adaptWire(c, dark);
  const hoverNet = useWorkspace((s) => s.hoverNet);
  const setHoverNet = useWorkspace((s) => s.setHoverNet);
  const links = useWorkspace((s) => s.catalogueLinks);
  const openCatalogue = useWorkspace((s) => s.openCatalogue);

  const cardStroke = (ref: string) => {
    const st = sim?.result.parts[ref]?.status;
    return st === 'burnt'
      ? 'var(--danger)'
      : st && st !== 'ok' && st !== 'idle'
        ? '#d97706'
        : 'var(--line)';
  };

  const model = useMemo(() => {
    const nets = computeNets(project);
    const used = new Map<string, Set<string>>();
    for (const c of project.connections)
      for (const e of [c.from, c.to]) {
        const { ref, pin } = parseEndpoint(e);
        used.set(ref, (used.get(ref) ?? new Set()).add(pin));
      }

    const boardPins = board.pins.filter((p) => used.get(BOARD_REF)?.has(p.id));
    const boardRowOrder = new Map(boardPins.map((p, i) => [p.id, i]));

    const mk = (
      ref: string,
      title: string,
      subtitle: string,
      pins: { id: string; label: string }[],
      art: string,
      linkKey: string,
      board: boolean,
    ): Card => ({
      ref,
      title,
      subtitle,
      x: 0,
      y: 0,
      w: board ? BOARD_W : PART_W,
      h: HEAD_H + pins.length * ROW_H + 6,
      rows: pins.map((p, i) => ({
        id: p.id,
        label: p.label,
        y: HEAD_H + 6 + i * ROW_H + ROW_H / 2,
      })),
      art,
      linkKey,
      side: null,
      board,
    });

    const boardCard = mk(
      BOARD_REF,
      board.name,
      t('diagram.board'),
      boardPins.map((p) => ({ id: p.id, label: p.label || p.id })),
      fitArt(renderBoardInner(board, { labels: false }), board.size.width, board.size.height),
      `board:${board.id}`,
      true,
    );

    const parts: Card[] = project.parts.map((part) => {
      const def = getComponent(part.componentId);
      const pinDefs = def?.pins ?? [];
      const shown = pinDefs.filter((p) => used.get(part.instanceId)?.has(p.id));
      const pins = (shown.length ? shown : pinDefs).map((p) => ({
        id: p.id,
        label: p.label || p.id,
      }));
      const art = def ? renderComponentArt(def, part.value) : undefined;
      return mk(
        part.instanceId,
        def
          ? `${componentName(part.componentId, def.name, locale)}${part.value ? ` · ${part.value}` : ''}`
          : part.instanceId,
        def
          ? `${part.instanceId} · ${t(`diagram.cat.${def.category}` as 'diagram.cat.generic')}`
          : part.instanceId,
        pins,
        art ? fitArt(art.svg, art.bbox.w, art.bbox.h, art.bbox.x, art.bbox.y) : '',
        `component:${part.componentId}`,
        false,
      );
    });

    // ── порядок: по положению связанных выводов платы; детали, связанные только с другими деталями, идут рядом с партнёром
    const partnerOf = new Map<string, string[]>();
    const boardScore = new Map<string, number>();
    for (const conn of project.connections) {
      const a = parseEndpoint(conn.from);
      const b = parseEndpoint(conn.to);
      for (const [p, q] of [
        [a, b],
        [b, a],
      ] as const) {
        if (p.ref === BOARD_REF) continue;
        if (q.ref === BOARD_REF) {
          const arr = boardScore.get(p.ref);
          const v = boardRowOrder.get(q.pin) ?? 0;
          boardScore.set(p.ref, arr === undefined ? v : (arr + v) / 2);
        } else partnerOf.set(p.ref, [...(partnerOf.get(p.ref) ?? []), q.ref]);
      }
    }
    const order = [...parts].sort(
      (x, y) => (boardScore.get(x.ref) ?? Infinity) - (boardScore.get(y.ref) ?? Infinity),
    );
    // детали без связи с платой — сразу после своего партнёра
    const placedOrder: Card[] = [];
    for (const c of order) {
      if (boardScore.has(c.ref)) placedOrder.push(c);
    }
    for (const c of order) {
      if (boardScore.has(c.ref)) continue;
      const partner = (partnerOf.get(c.ref) ?? [])
        .map((r) => placedOrder.findIndex((x) => x.ref === r))
        .find((i) => i >= 0);
      placedOrder.splice(partner === undefined ? placedOrder.length : partner + 1, 0, c);
    }

    // ── стороны: уравновешиваем по высоте, партнёр остаётся на одной стороне
    const heights = { left: 0, right: 0 };
    const sideOf = new Map<string, Side>();
    for (const c of placedOrder) {
      const partnerSide = (partnerOf.get(c.ref) ?? []).map((r) => sideOf.get(r)).find(Boolean);
      const side: Side = partnerSide ?? (heights.left <= heights.right ? 'left' : 'right');
      sideOf.set(c.ref, side);
      c.side = side;
      heights[side] += c.h + GAP_Y;
    }

    // ── колонки: переносим наружу, когда высота превышает порог
    const colMax = Math.max(
      MIN_COL_H,
      Math.max(heights.left, heights.right) /
        Math.ceil(Math.max(heights.left, heights.right) / (MIN_COL_H * 1.35)),
    );
    const columns: Record<Side, Card[][]> = { left: [[]], right: [[]] };
    const colH: Record<Side, number[]> = { left: [0], right: [0] };
    for (const c of placedOrder) {
      const s = c.side!;
      let k = columns[s].length - 1;
      if (colH[s][k] > 0 && colH[s][k] + c.h > colMax) {
        columns[s].push([]);
        colH[s].push(0);
        k++;
      }
      columns[s][k].push(c);
      colH[s][k] += c.h + GAP_Y;
    }

    const tallest = Math.max(0, ...colH.left, ...colH.right) - GAP_Y;
    const centerY = Math.max(tallest, boardCard.h) / 2;
    boardCard.x = 0;
    boardCard.y = centerY - boardCard.h / 2;
    for (const s of ['left', 'right'] as const) {
      columns[s].forEach((col, k) => {
        const total = colH[s][k] - GAP_Y;
        let y = centerY - total / 2;
        for (const c of col) {
          c.x =
            s === 'left'
              ? -BOARD_GAP - PART_W - k * (PART_W + COL_GAP)
              : BOARD_W + BOARD_GAP + k * (PART_W + COL_GAP);
          c.y = y;
          y += c.h + GAP_Y;
        }
      });
    }

    const cards = [...parts, boardCard];
    const find = (e: string) => {
      const { ref, pin } = parseEndpoint(e);
      const card = cards.find((c) => c.ref === ref);
      const row = card?.rows.find((r) => r.id === pin);
      return card && row ? { card, row } : undefined;
    };

    const wires = project.connections.flatMap((conn, index) => {
      const a = find(conn.from);
      const b = find(conn.to);
      if (!a || !b) return [];
      // точка выхода провода из карточки: у деталей — край, обращённый к плате; у платы — край со стороны детали
      const edge = (self: Card, other: Card): { x: number; dir: 1 | -1 } => {
        if (self.board)
          return other.side === 'left' ? { x: self.x, dir: -1 } : { x: self.x + self.w, dir: 1 };
        return self.side === 'left' ? { x: self.x + self.w, dir: 1 } : { x: self.x, dir: -1 };
      };
      const ea = edge(a.card, b.card);
      const eb = edge(b.card, a.card);
      const ya = a.card.y + a.row.y;
      const yb = b.card.y + b.row.y;
      const bulge = Math.max(64, Math.abs(eb.x - ea.x) * 0.42);
      const d = `M ${ea.x} ${ya} C ${ea.x + ea.dir * bulge} ${ya}, ${eb.x + eb.dir * bulge} ${yb}, ${eb.x} ${yb}`;
      const boardPin = (e: string) => {
        const p = parseEndpoint(e);
        return p.ref === BOARD_REF ? board.pins.find((x) => x.id === p.pin) : undefined;
      };
      return [
        {
          index,
          d,
          from: { x: ea.x, y: ya },
          to: { x: eb.x, y: yb },
          color: wireColor(conn, [boardPin(conn.from), boardPin(conn.to)]),
          net: nets.netOfConnection[index],
        },
      ];
    });

    const xs = cards.flatMap((c) => [c.x, c.x + c.w]);
    const ys = cards.flatMap((c) => [c.y, c.y + c.h]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      cards,
      wires,
      bounds: {
        x: minX - 40,
        y: minY - 40,
        w: Math.max(...xs) - minX + 80,
        h: Math.max(...ys) - minY + 80,
      },
    };
  }, [project, board, t, locale]);

  return (
    <div className="bg-dots relative h-full min-h-0">
      <Viewport bounds={model.bounds} fitKey={`${projectId}|${board.id}|diagram`} minK={0.04}>
        {/* провода под карточками: уходя за ближние карточки, они не загораживают текст */}
        {model.wires.map((w) => {
          const dim = hoverNet !== null && hoverNet !== w.net;
          return (
            <g key={w.index} opacity={dim ? 0.15 : 1} style={{ transition: 'opacity .2s' }}>
              <path
                d={w.d}
                fill="none"
                stroke={wc(w.color)}
                strokeWidth={hoverNet === w.net ? 3.6 : 2.2}
                strokeLinecap="round"
                pathLength={1000}
                className="wire-draw"
                style={{ ['--len' as string]: 1000, ['--i' as string]: w.index }}
              />
              {sim && Math.abs(sim.result.wires[w.index]?.i ?? 0) > 1e-5 && (
                <path
                  d={w.d}
                  fill="none"
                  stroke="#fff"
                  strokeOpacity={0.9}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeDasharray="5 25"
                  className="current-flow-px"
                  style={{
                    ['--dur' as string]: `${flowSeconds(sim.result.wires[w.index].i)}s`,
                    animationDirection: sim.result.wires[w.index].i < 0 ? 'reverse' : 'normal',
                  }}
                  pointerEvents="none"
                />
              )}
              <path
                d={w.d}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                className="cursor-pointer"
                onPointerEnter={() => setHoverNet(w.net)}
                onPointerLeave={() => setHoverNet(null)}
              >
                {sim && <title>{formatCurrent(sim.result.wires[w.index]?.i ?? 0)}</title>}
              </path>
            </g>
          );
        })}

        {model.cards.map((c) => {
          const link = links[c.linkKey];
          const left = c.side === 'left';
          return (
            <g
              key={c.ref}
              className="animate-fade-up"
              style={{ ['--i' as string]: c.board ? 4 : 0 }}
            >
              <rect
                x={c.x}
                y={c.y}
                width={c.w}
                height={c.h}
                rx={16}
                fill="var(--panel)"
                stroke={cardStroke(c.ref)}
                strokeWidth={sim && cardStroke(c.ref) !== 'var(--line)' ? 2.4 : 1.2}
              />
              <g transform={`translate(${c.x} ${c.y})`}>
                {link?.image ? (
                  <g
                    className="cursor-pointer"
                    onClick={() => openCatalogue(link.id)}
                    role="link"
                    aria-label={link.name}
                  >
                    <rect x={10} y={10} width={ART} height={ART} rx={10} fill="#fff" />
                    <image
                      href={link.image}
                      x={13}
                      y={13}
                      width={ART - 6}
                      height={ART - 6}
                      preserveAspectRatio="xMidYMid meet"
                    />
                  </g>
                ) : (
                  <g dangerouslySetInnerHTML={{ __html: c.art }} />
                )}
                <text x={70} y={29} fontSize={14} fontWeight={600} fill="var(--fg)">
                  {cut(c.title, c.board ? 28 : 24)}
                </text>
                <text x={70} y={47} fontSize={11} fill="var(--muted)">
                  {cut(c.subtitle, 32)}
                </text>
                {c.rows.map((r) => (
                  <g key={r.id}>
                    <line
                      x1={0}
                      x2={c.w}
                      y1={r.y - ROW_H / 2}
                      y2={r.y - ROW_H / 2}
                      stroke="var(--line)"
                    />
                    <text
                      x={c.board ? c.w / 2 : left ? c.w - 16 : 16}
                      y={r.y + 4.5}
                      textAnchor={c.board ? 'middle' : left ? 'end' : 'start'}
                      fontSize={13}
                      fill="var(--fg)"
                    >
                      {cut(r.label, 22)}
                    </text>
                  </g>
                ))}
              </g>
            </g>
          );
        })}

        {model.wires.map((w) => {
          const dim = hoverNet !== null && hoverNet !== w.net;
          return (
            <g key={`dots-${w.index}`} opacity={dim ? 0.15 : 1} pointerEvents="none">
              {[w.from, w.to].map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={3.8}
                  fill="var(--panel)"
                  stroke={wc(w.color)}
                  strokeWidth={2}
                />
              ))}
            </g>
          );
        })}
      </Viewport>
      <p className="text-muted pointer-events-none absolute right-16 bottom-3 left-4 text-xs">
        {t('diagram.hint')}
      </p>
    </div>
  );
}
