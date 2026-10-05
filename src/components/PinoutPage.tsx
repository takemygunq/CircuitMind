/* eslint-disable @next/next/no-img-element */
'use client';

import { useMemo } from 'react';
import { getComponent } from '@/core/library';
import type { BoardDef, PinDef } from '@/core/schema';
import { componentName } from '@/i18n/library';
import { useWorkspace } from '@/store/workspace';
import { useT } from './useT';

interface PinPill {
  label: string;
  type: string;
  hint?: string;
}

const COLORS: Record<string, { bg: string; fg: string }> = {
  power: { bg: '#d6321e', fg: '#fff' },
  ground: { bg: '#111114', fg: '#fff' },
  gpio: { bg: '#68c22d', fg: '#0b1a05' },
  analog: { bg: '#2f7d3a', fg: '#fff' },
  uart: { bg: '#6b4fc0', fg: '#fff' },
  i2c: { bg: '#2f86c4', fg: '#fff' },
  spi: { bg: '#2f86c4', fg: '#fff' },
  control: { bg: '#e48b95', fg: '#2a0a0e' },
  unknown: { bg: 'transparent', fg: 'var(--fg)' },
};
const colorOf = (type: string) => COLORS[type] ?? COLORS.unknown;

/** Тип вывода для цвета плашки по функциям нашей библиотеки. */
function libraryType(pin: PinDef): string {
  const f = pin.functions;
  if (f.includes('gnd')) return 'ground';
  if (f.includes('power')) return 'power';
  if (f.some((x) => x === 'i2c_sda' || x === 'i2c_scl')) return 'i2c';
  if (f.some((x) => x.startsWith('spi_'))) return 'spi';
  if (f.some((x) => x.startsWith('uart_'))) return 'uart';
  if (f.includes('adc') || f.includes('dac')) return 'analog';
  if (f.includes('gpio') || f.includes('pwm') || f.includes('touch')) return 'gpio';
  return 'control';
}

const ROW = 34;

/** Название на чипе читается снизу вверх: обрезаем так, чтобы оно целиком помещалось по высоте чипа. */
function fitTitle(title: string, height: number): string {
  const max = Math.max(6, Math.floor(height / 8.6));
  const up = title.toUpperCase();
  return up.length <= max ? up : `${up.slice(0, max - 1)}…`;
}
const PILL_H = 24;

/** Логическая распиновка в стиле каталога: чип с золотыми точками и цветные плашки выводов слева и справа. */
function LogicalPinout({ title, pins }: { title: string; pins: PinPill[] }) {
  const rows = Math.max(1, Math.ceil(pins.length / 2));
  const left = pins.slice(0, rows);
  const right = pins.slice(rows);
  const pillW = (p: PinPill) => Math.min(190, Math.max(54, p.label.length * 7.4 + 26));
  const sideW = Math.max(80, ...pins.map(pillW)) + 34;
  const chipW = 118;
  const W = sideW * 2 + chipW;
  const H = rows * ROW + 56;
  const cx = sideW;
  const y = (i: number) => 38 + i * ROW;

  const pill = (p: PinPill, i: number, side: 'l' | 'r') => {
    const w = pillW(p);
    const c = colorOf(p.type);
    const x = side === 'l' ? cx - 14 - w - 6 : cx + chipW + 14 + 6;
    const dotX = side === 'l' ? cx + 14 : cx + chipW - 14;
    const edge = side === 'l' ? x + w : x;
    return (
      <g key={`${side}${i}`}>
        <title>{p.hint ? `${p.label} — ${p.hint}` : p.label}</title>
        <line
          x1={edge}
          x2={dotX}
          y1={y(i)}
          y2={y(i)}
          stroke="var(--muted)"
          strokeWidth={1.2}
          opacity={0.6}
        />
        <circle cx={dotX} cy={y(i)} r={4.5} fill="#e0a300" />
        <rect
          x={x}
          y={y(i) - PILL_H / 2}
          width={w}
          height={PILL_H}
          rx={6}
          fill={c.bg}
          stroke={p.type === 'unknown' ? 'var(--muted)' : 'transparent'}
          strokeWidth={1.6}
        />
        <text
          x={x + w / 2}
          y={y(i) + 4}
          textAnchor="middle"
          fontSize={11.5}
          fontWeight={700}
          fill={c.fg}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {p.label.length > 26 ? `${p.label.slice(0, 25)}…` : p.label}
        </text>
      </g>
    );
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mx-auto h-auto w-full"
      style={{ maxWidth: Math.max(W, 420) }}
      role="img"
      aria-label={title}
    >
      <rect
        x={cx}
        y={8}
        width={chipW}
        height={H - 16}
        rx={16}
        fill="#111114"
        stroke="var(--line)"
        strokeWidth={1.2}
      />
      {[22, H - 22].flatMap((yy) =>
        [cx + 18, cx + chipW - 18].map((xx) => (
          <circle
            key={`${xx}-${yy}`}
            cx={xx}
            cy={yy}
            r={7}
            fill="none"
            stroke="#6b6b73"
            strokeWidth={1.5}
          />
        )),
      )}
      <text
        transform={`translate(${cx + chipW / 2} ${H / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={11}
        letterSpacing="0.18em"
        fill="#8d8d96"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {fitTitle(title, H - 56)}
      </text>
      {left.map((p, i) => pill(p, i, 'l'))}
      {right.map((p, i) => pill(p, i, 'r'))}
    </svg>
  );
}

interface Section {
  ref: string;
  title: string;
  subtitle: string;
  image?: string;
  pins: PinPill[];
  source: 'catalogue' | 'library';
}

/** Вкладка «Распиновка»: логическая схема выводов для платы и каждого компонента проекта. */
export function PinoutPage({ board }: { board: BoardDef }) {
  const t = useT();
  const project = useWorkspace((s) => s.project);
  const links = useWorkspace((s) => s.catalogueLinks);
  const locale = useWorkspace((s) => s.locale);
  const openCatalogue = useWorkspace((s) => s.openCatalogue);

  const sections = useMemo<Section[]>(() => {
    const make = (
      ref: string,
      title: string,
      subtitle: string,
      linkKey: string,
      own: PinPill[],
    ): Section => {
      const link = links[linkKey];
      const fromCatalogue = link?.pins?.length
        ? link.pins.map<PinPill>((p) => ({
            label: p.label,
            type: p.type && COLORS[p.type] ? p.type : p.type === 'ground' ? 'ground' : 'unknown',
            hint: p.function,
          }))
        : null;
      return {
        ref,
        title,
        subtitle,
        image: link?.image,
        pins: fromCatalogue ?? own,
        source: fromCatalogue ? 'catalogue' : 'library',
      };
    };
    const ownPins = (pins: PinDef[]) =>
      pins.map<PinPill>((p) => ({
        label: p.label || p.id,
        type: libraryType(p),
        hint: p.notes?.[0],
      }));
    return [
      make('board', board.name, t('diagram.board'), `board:${board.id}`, ownPins(board.pins)),
      ...project.parts.flatMap<Section>((part) => {
        const def = getComponent(part.componentId);
        if (!def) return [];
        return [
          make(
            part.instanceId,
            `${componentName(part.componentId, def.name, locale)}${part.value ? ` · ${part.value}` : ''}`,
            part.instanceId,
            `component:${part.componentId}`,
            ownPins(def.pins),
          ),
        ];
      }),
    ];
  }, [project, board, links, t, locale]);

  return (
    <div className="glow-accent min-h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 sm:px-8">
        <p className="eyebrow">{t('pinout.logical')}</p>
        <div className="flex flex-wrap items-center gap-4">
          {Object.entries(COLORS)
            .filter(([k]) => k !== 'spi')
            .map(([k, c]) => (
              <span key={k} className="text-muted flex items-center gap-1.5 text-xs">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{
                    background: c.bg,
                    border: k === 'unknown' ? '1.5px solid var(--muted)' : 'none',
                  }}
                />
                {t(`pinout.type.${k}` as 'pinout.type.power')}
              </span>
            ))}
        </div>
        <div style={{ columnWidth: '26rem', columnGap: '1rem' }}>
          {sections.map((s, i) => (
            <section
              key={s.ref}
              className="card animate-fade-up mb-4 break-inside-avoid p-5"
              style={{ ['--i' as string]: Math.min(i, 8) }}
              aria-label={s.title}
            >
              <header className="mb-4 flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white">
                  {s.image && (
                    <img
                      src={s.image}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-contain p-1"
                    />
                  )}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold">{s.title}</h2>
                  <p className="text-muted font-mono text-xs">{s.subtitle}</p>
                </div>
                {s.source === 'catalogue' && (
                  <span className="eyebrow ml-auto shrink-0">{t('pinout.fromCatalogue')}</span>
                )}
              </header>
              <LogicalPinout title={s.title} pins={s.pins} />
              {links[
                s.ref === 'board'
                  ? `board:${board.id}`
                  : `component:${project.parts.find((p) => p.instanceId === s.ref)?.componentId}`
              ] && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    className="text-muted hover:text-accent text-xs underline"
                    onClick={() =>
                      openCatalogue(
                        links[
                          s.ref === 'board'
                            ? `board:${board.id}`
                            : `component:${project.parts.find((p) => p.instanceId === s.ref)?.componentId}`
                        ].id,
                      )
                    }
                  >
                    {t('pinout.details')}
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
