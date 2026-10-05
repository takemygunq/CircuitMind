'use client';

import { useMemo } from 'react';
import { bomToCsv, bomTotals, compareBom, deriveBom, initialOwned } from '@/core/bom';
import { ownedFromInventory } from '@/core/inventory';
import { exportFilename } from '@/core/export';
import type { BoardDef } from '@/core/schema';
import { componentName } from '@/i18n/library';
import { useWorkspace } from '@/store/workspace';
import { downloadText } from './exporters';
import { useT } from './useT';

const usd = (n: number | undefined) => (n === undefined ? '—' : n.toFixed(2));

/** Список компонентов: собирается по деталям схемы, цены примерные, отметка «есть у меня» запоминается. */
export function BomView({ board }: { board: BoardDef }) {
  const t = useT();
  const project = useWorkspace((s) => s.project);
  const projectId = useWorkspace((s) => s.projectId);
  const ownedKeys = useWorkspace((s) => s.owned[s.projectId]);
  const inventory = useWorkspace((s) => s.inventory);
  const locale = useWorkspace((s) => s.locale);
  const links = useWorkspace((s) => s.catalogueLinks);
  const setOwned = useWorkspace((s) => s.setOwned);

  const lines = useMemo(() => deriveBom(project, board), [project, board]);
  // без ручных отметок «есть у меня» берём запасы пользователя (Режим 2), иначе — отметки ИИ
  const owned = useMemo(
    () =>
      new Set(
        ownedKeys ??
          (inventory.items.length
            ? [...ownedFromInventory(lines, inventory)]
            : [...initialOwned(project)]),
      ),
    [ownedKeys, project, inventory, lines],
  );
  const totals = useMemo(() => bomTotals(lines, owned), [lines, owned]);
  const mismatch = useMemo(() => compareBom(project, lines), [project, lines]);
  const nameOf = (key: string) => lines.find((l) => l.key === key)?.name ?? key.split('|')[0];

  const toggle = (key: string) => {
    const next = new Set(owned);
    if (!next.delete(key)) next.add(key);
    setOwned(projectId, [...next]);
  };

  const exportCsv = () =>
    downloadText(
      exportFilename(project, 'bom', 'csv'),
      'text/csv',
      bomToCsv(
        lines.map((l) => (l.isBoard ? { ...l, name: `${t('bom.board')}: ${l.name}` } : l)),
        owned,
        {
          refs: t('bom.col.refs'),
          component: t('bom.col.component'),
          value: t('bom.col.value'),
          package: t('bom.col.package'),
          qty: t('bom.col.qty'),
          unit: t('bom.col.unit'),
          line: t('bom.col.line'),
          owned: t('bom.col.owned'),
        },
        t('bom.yes'),
        t('bom.no'),
      ),
    );

  return (
    <div className="flex w-full flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('bom.title')}</h1>
        <button
          type="button"
          onClick={exportCsv}
          className="border-line bg-panel hover:bg-canvas focus-visible:outline-accent rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:outline-2"
        >
          ⬇ {t('bom.csv')}
        </button>
      </header>

      {mismatch.length > 0 && (
        <div role="note" className="bg-warn-bg text-warn-fg rounded-lg px-4 py-3 text-sm">
          <p>{t('bom.mismatch')}</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {mismatch.map((m) => (
              <li key={m.key}>
                {t('bom.diff', { name: nameOf(m.key), expected: m.expected, declared: m.declared })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-line bg-panel overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-muted border-line border-b text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">{t('bom.col.refs')}</th>
              <th className="px-3 py-2 font-medium">{t('bom.col.component')}</th>
              <th className="px-3 py-2 font-medium">{t('bom.col.value')}</th>
              <th className="px-3 py-2 font-medium">{t('bom.col.package')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('bom.col.qty')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('bom.col.unit')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('bom.col.line')}</th>
              <th className="px-3 py-2 text-center font-medium">{t('bom.col.owned')}</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {lines.map((l) => (
              <tr key={l.key} className={owned.has(l.key) ? 'text-muted' : ''}>
                <td className="px-3 py-2 font-mono text-xs">{l.refs.join(' ')}</td>
                <td className="px-3 py-2">
                  {links[
                    `${l.isBoard ? 'board' : 'component'}:${l.isBoard ? project.boardId : l.componentId}`
                  ]?.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={
                        links[
                          `${l.isBoard ? 'board' : 'component'}:${l.isBoard ? project.boardId : l.componentId}`
                        ].image
                      }
                      alt=""
                      loading="lazy"
                      className="mr-2 inline-block h-7 w-7 rounded bg-white object-contain align-middle"
                    />
                  )}
                  {l.isBoard ? l.name : componentName(l.componentId, l.name, locale)}
                  {l.unverified && (
                    <span className="bg-warn-bg text-warn-fg ml-2 rounded px-1.5 py-0.5 text-xs">
                      {t('bom.unverified')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{l.value ?? ''}</td>
                <td className="px-3 py-2 text-xs">{l.package ?? ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.qty}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd(l.unitUsd)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd(l.lineUsd)}</td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={owned.has(l.key)}
                    onChange={() => toggle(l.key)}
                    aria-label={`${t('bom.col.owned')}: ${l.name} ${l.value ?? ''}`}
                    className="accent-accent h-4 w-4"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          [t('bom.total'), totals.totalUsd],
          [t('bom.toBuy'), totals.toBuyUsd],
          [t('bom.ownedSum'), totals.ownedUsd],
        ].map(([label, value]) => (
          <div key={label as string} className="border-line bg-panel rounded-lg border px-4 py-3">
            <dt className="text-muted text-xs">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">$ {usd(value as number)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted text-xs">
        {t('bom.approx')} {totals.unpriced > 0 && t('bom.unpriced', { n: totals.unpriced })}
      </p>
    </div>
  );
}
