/* eslint-disable @next/next/no-img-element */
'use client';

import { ExternalLink } from 'lucide-react';
import { useMemo } from 'react';
import { getComponent } from '@/core/library';
import { computeNets } from '@/core/nets';
import { BOARD_REF, parseEndpoint, type BoardDef } from '@/core/schema';
import { adaptWire, wireColor } from '@/diagram/colors';
import { componentName } from '@/i18n/library';
import { useWorkspace } from '@/store/workspace';
import { useT } from './useT';

interface PinRow {
  id: string;
  label: string;
  net?: number;
  color: string;
  targets: string[];
}
interface CardData {
  ref: string;
  title: string;
  subtitle: string;
  linkKey: string;
  rows: PinRow[];
}

/**
 * Карточки деталей как в «Диаграмме»: фото из каталога, название и список выводов с тем, куда и что подключено.
 * Используется справа от схем (подключение, принципиальная, симуляция).
 */
export function PartCards({ board }: { board: BoardDef }) {
  const t = useT();
  const project = useWorkspace((s) => s.project);
  const links = useWorkspace((s) => s.catalogueLinks);
  const selection = useWorkspace((s) => s.selection);
  const select = useWorkspace((s) => s.select);
  const setHoverNet = useWorkspace((s) => s.setHoverNet);
  const openCatalogue = useWorkspace((s) => s.openCatalogue);
  const dark = useWorkspace((s) => s.theme) === 'dark';
  const locale = useWorkspace((s) => s.locale);

  const cards = useMemo<CardData[]>(() => {
    const nets = computeNets(project);
    const short = (e: string) => {
      const { ref, pin } = parseEndpoint(e);
      if (ref === BOARD_REF) {
        const p = board.pins.find((x) => x.id === pin);
        return `${board.name.split(' ')[0]} · ${p?.label ?? pin}`;
      }
      const part = project.parts.find((x) => x.instanceId === ref);
      const p = getComponent(part?.componentId ?? '')?.pins.find((x) => x.id === pin);
      return `${ref} · ${p?.label ?? pin}`;
    };
    const colorOf = (ep: string, pinFns: string[]) => {
      const i = project.connections.findIndex((c) => c.from === ep || c.to === ep);
      if (i < 0) return 'var(--line)';
      return adaptWire(
        wireColor(project.connections[i], [{ functions: pinFns as ('power' | 'gnd')[] }]),
        dark,
      );
    };
    const rowFor = (
      ref: string,
      pin: { id: string; label?: string; functions?: string[] },
    ): PinRow => {
      const ep = `${ref}:${pin.id}`;
      const net = nets.netOfEndpoint.get(ep);
      const targets =
        net === undefined
          ? []
          : nets.nets[net].endpoints.filter((e) => e !== ep).map((e) => short(e));
      return {
        id: pin.id,
        label: pin.label || pin.id,
        net,
        color: colorOf(ep, pin.functions ?? []),
        targets,
      };
    };

    const used = new Set(project.connections.flatMap((c) => [c.from, c.to]));
    const boardCard: CardData = {
      ref: BOARD_REF,
      title: board.name,
      subtitle: t('diagram.board'),
      linkKey: `board:${board.id}`,
      rows: board.pins
        .filter((p) => used.has(`${BOARD_REF}:${p.id}`))
        .map((p) => rowFor(BOARD_REF, p)),
    };
    const partCards = project.parts.map<CardData>((part) => {
      const def = getComponent(part.componentId);
      const pins = def?.pins ?? [];
      return {
        ref: part.instanceId,
        title: def
          ? `${componentName(part.componentId, def.name, locale)}${part.value ? ` · ${part.value}` : ''}`
          : part.instanceId,
        subtitle: part.instanceId,
        linkKey: `component:${part.componentId}`,
        rows: pins.map((p) => rowFor(part.instanceId, p)),
      };
    });
    return [boardCard, ...partCards];
  }, [project, board, dark, t, locale]);

  return (
    <ul className="flex flex-col gap-3">
      {cards.map((c) => {
        const link = links[c.linkKey];
        const selected = selection?.kind === 'part' && selection.id === c.ref;
        return (
          <li
            key={c.ref}
            className={`card overflow-hidden ${selected ? 'ring-accent ring-2' : ''}`}
            style={{ borderRadius: 'var(--radius-xl)' }}
          >
            <div className="flex items-center gap-3 p-3">
              <button
                type="button"
                onClick={() => c.ref !== BOARD_REF && select({ kind: 'part', id: c.ref })}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-white">
                  {link?.image && (
                    <img
                      src={link.image}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-contain p-1"
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] leading-tight font-semibold">
                    {c.title}
                  </span>
                  <span className="text-muted block truncate font-mono text-[11px]">
                    {c.subtitle}
                  </span>
                </span>
              </button>
              {link && (
                <button
                  type="button"
                  aria-label={`${t('parts.eyebrow')}: ${link.name}`}
                  title={t('parts.eyebrow')}
                  onClick={() => openCatalogue(link.id)}
                  className="text-muted hover:text-accent shrink-0 p-1"
                >
                  <ExternalLink size={15} />
                </button>
              )}
            </div>
            <ul className="border-line divide-line divide-y border-t">
              {c.rows.map((r) => (
                <li
                  key={r.id}
                  className="hover:bg-panel-2 flex items-baseline gap-2 px-3 py-1.5 text-xs"
                  onPointerEnter={() => r.net !== undefined && setHoverNet(r.net)}
                  onPointerLeave={() => setHoverNet(null)}
                >
                  <span
                    className="mt-0.5 h-2 w-2 shrink-0 self-center rounded-full"
                    style={{ background: r.color }}
                  />
                  <span className="w-16 shrink-0 truncate font-mono font-medium">{r.label}</span>
                  <span
                    className="text-muted min-w-0 flex-1 truncate text-right"
                    title={r.targets.join(', ')}
                  >
                    {r.targets.length === 0
                      ? '—'
                      : `${r.targets.slice(0, 2).join(', ')}${r.targets.length > 2 ? ` +${r.targets.length - 2}` : ''}`}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
