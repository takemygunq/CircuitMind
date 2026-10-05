'use client';

import { useEffect, useRef, useState } from 'react';
import { deriveBom, initialOwned, bomToCsv } from '@/core/bom';
import { MAX_IMPORT_BYTES, exportFilename, parseProjectJson, projectToJson } from '@/core/export';
import type { MessageKey } from '@/i18n';
import { renderPinoutSvg, renderWiringSvg } from '@/diagram/export-svg';
import { renderSchematicSvg } from '@/diagram/schematic';
import { useWorkspace } from '@/store/workspace';
import { downloadBlob, downloadText, svgToPngBlob } from './exporters';
import { useBoard } from './useBoard';
import { useT } from './useT';

/** Меню экспорта: JSON проекта, CSV компонентов, SVG/PNG схемы, SVG распиновки, импорт JSON. */
export function ExportMenu() {
  const t = useT();
  const { board } = useBoard();
  const project = useWorkspace((s) => s.project);
  const overrides = useWorkspace((s) => s.overrides);
  const owned = useWorkspace((s) => s.owned[s.projectId]);
  const setGenerated = useWorkspace((s) => s.setGenerated);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const run = (action: () => void | Promise<void>) => async () => {
    setOpen(false);
    try {
      await action();
    } catch {
      setMessage({ text: t('export.pngFailed'), error: true });
    }
  };

  const items: { key: MessageKey; needsBoard: boolean; action: () => void | Promise<void> }[] = [
    {
      key: 'export.json',
      needsBoard: false,
      action: () =>
        downloadText(
          exportFilename(project, '', 'json'),
          'application/json',
          projectToJson(project),
        ),
    },
    {
      key: 'export.csv',
      needsBoard: true,
      action: () => {
        const keys = new Set(owned ?? [...initialOwned(project)]);
        downloadText(
          exportFilename(project, 'bom', 'csv'),
          'text/csv',
          bomToCsv(
            deriveBom(project, board),
            keys,
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
      },
    },
    {
      key: 'export.wiringSvg',
      needsBoard: true,
      action: () =>
        downloadText(
          exportFilename(project, 'wiring', 'svg'),
          'image/svg+xml',
          renderWiringSvg(project, board!, { overrides, background: true }).svg,
        ),
    },
    {
      key: 'export.wiringPng',
      needsBoard: true,
      action: async () => {
        const out = renderWiringSvg(project, board!, { overrides, background: true });
        downloadBlob(
          await svgToPngBlob(out.svg, out.width, out.height, 2),
          exportFilename(project, 'wiring', 'png'),
        );
      },
    },
    {
      key: 'export.schematicSvg',
      needsBoard: true,
      action: () =>
        downloadText(
          exportFilename(project, 'schematic', 'svg'),
          'image/svg+xml',
          renderSchematicSvg(project, board!, { background: true }).svg,
        ),
    },
    {
      key: 'export.pinoutSvg',
      needsBoard: true,
      action: () =>
        downloadText(
          exportFilename(project, 'pinout', 'svg'),
          'image/svg+xml',
          renderPinoutSvg(project, board!, { background: true }).svg,
        ),
    },
  ];

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES)
      return setMessage({ text: t('export.fail.too_large'), error: true });
    const result = parseProjectJson(await file.text());
    if (!result.ok)
      return setMessage({ text: t(`export.fail.${result.error}` as MessageKey), error: true });
    setGenerated(result.project, true);
    setMessage({ text: t('export.imported', { title: result.project.title }), error: false });
  };

  return (
    <div ref={root} className="relative my-1.5 shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="border-line bg-panel hover:bg-canvas focus-visible:outline-accent flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline-2"
      >
        ⬇ {t('export.menu')}
      </button>
      {open && (
        <ul
          role="menu"
          className="border-line bg-panel absolute right-0 z-40 mt-1 w-64 rounded-lg border py-1 shadow-lg"
        >
          {items.map((it) => (
            <li key={it.key} role="none">
              <button
                role="menuitem"
                type="button"
                disabled={it.needsBoard && !board}
                onClick={run(it.action)}
                className="hover:bg-canvas focus-visible:bg-canvas w-full px-3 py-2 text-left text-sm disabled:opacity-40"
              >
                {t(it.key)}
              </button>
            </li>
          ))}
          <li role="none" className="border-line mt-1 border-t pt-1">
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                fileInput.current?.click();
              }}
              className="hover:bg-canvas focus-visible:bg-canvas w-full px-3 py-2 text-left text-sm"
            >
              {t('export.import')}
            </button>
          </li>
        </ul>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {message && (
        <p
          role="status"
          className={`absolute right-0 z-40 mt-1 w-64 rounded-md px-3 py-2 text-xs shadow-lg ${message.error ? 'bg-danger-bg text-danger-fg' : 'bg-info-bg text-info-fg'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
