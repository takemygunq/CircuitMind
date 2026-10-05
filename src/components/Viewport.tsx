'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Point } from '@/core/schema';
import { COMPONENT_DEFS } from '@/diagram/component-art/render';
import type { Rect } from '@/diagram/routing';
import { useT } from './useT';

interface ViewportApi {
  /** пикселей на мм */
  k: number;
  toWorld: (clientX: number, clientY: number) => Point;
}
const Ctx = createContext<ViewportApi>({ k: 1, toWorld: (x, y) => ({ x, y }) });
export const useViewport = () => useContext(Ctx);

interface View {
  tx: number;
  ty: number;
  k: number;
}
const MIN_K = 1.5;
const MAX_K = 90;

/** SVG-холст с зумом (колесо/кнопки), панорамой (перетаскивание фона) и сеткой. */
export function Viewport({
  bounds,
  fitKey,
  children,
  onBackgroundClick,
  overlay,
  minK = MIN_K,
}: {
  bounds: Rect;
  /** Меняется → вписать сцену в экран заново. */
  fitKey: string;
  children: ReactNode;
  onBackgroundClick?: () => void;
  overlay?: ReactNode;
  /** Минимальный масштаб (пикселей на единицу): для крупных сцен вроде диаграммы он ниже. */
  minK?: number;
}) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ tx: 0, ty: 0, k: 4 });
  const pan = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    const margin = 24;
    const k = Math.min(
      MAX_K,
      Math.max(minK, Math.min((size.w - margin * 2) / bounds.w, (size.h - margin * 2) / bounds.h)),
    );
    setView({
      k,
      tx: (size.w - bounds.w * k) / 2 - bounds.x * k,
      ty: (size.h - bounds.h * k) / 2 - bounds.y * k,
    });
  }, [size, bounds, minK]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lastFit = useRef<string>('');
  useEffect(() => {
    const key = `${fitKey}|${size.w > 0}`;
    if (size.w > 0 && lastFit.current !== key) {
      lastFit.current = key;
      fit();
    }
  }, [fitKey, size.w, fit]);

  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      setView((v) => {
        const k = Math.min(MAX_K, Math.max(minK, v.k * factor));
        const f = k / v.k;
        return { k, tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f };
      });
    },
    [minK],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(
        e.clientX - r.left,
        e.clientY - r.top,
        Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)),
      );
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const r = svgRef.current?.getBoundingClientRect();
      return {
        x: (clientX - (r?.left ?? 0) - view.tx) / view.k,
        y: (clientY - (r?.top ?? 0) - view.ty) / view.k,
      };
    },
    [view],
  );
  const api = useMemo(() => ({ k: view.k, toWorld }), [view.k, toWorld]);

  const gridPx = 2.54 * 2 * view.k;
  return (
    <div
      ref={wrapRef}
      className="bg-canvas relative h-full min-h-72 w-full overflow-hidden"
      style={{
        backgroundImage: 'radial-gradient(var(--grid) 1px, transparent 1px)',
        backgroundSize: `${gridPx}px ${gridPx}px`,
        backgroundPosition: `${view.tx}px ${view.ty}px`,
      }}
    >
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        style={{ color: 'var(--ink)' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          pan.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
          svgRef.current?.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const p = pan.current;
          if (!p) return;
          const dx = e.clientX - p.x;
          const dy = e.clientY - p.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
          if (p.moved) setView((v) => ({ ...v, tx: p.tx + dx, ty: p.ty + dy }));
        }}
        onPointerUp={() => {
          const p = pan.current;
          pan.current = null;
          if (p && !p.moved) onBackgroundClick?.();
        }}
        onPointerCancel={() => (pan.current = null)}
      >
        <defs dangerouslySetInnerHTML={{ __html: COMPONENT_DEFS }} />
        <Ctx.Provider value={api}>
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>{children}</g>
        </Ctx.Provider>
      </svg>
      <div className="absolute top-3 right-3 flex flex-col gap-1">
        <ToolButton label={t('wiring.zoomIn')} onClick={() => zoomAt(size.w / 2, size.h / 2, 1.3)}>
          +
        </ToolButton>
        <ToolButton
          label={t('wiring.zoomOut')}
          onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.3)}
        >
          −
        </ToolButton>
        <ToolButton label={t('wiring.fit')} onClick={fit}>
          ⤢
        </ToolButton>
      </div>
      {overlay}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="border-line bg-panel text-fg hover:bg-canvas focus-visible:outline-accent flex h-9 w-9 items-center justify-center rounded-md border text-lg leading-none shadow-sm focus-visible:outline-2"
    >
      {children}
    </button>
  );
}
