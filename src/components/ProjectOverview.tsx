'use client';

import type { ReactNode } from 'react';
import { getComponent } from '@/core/library';
import type { BoardDef } from '@/core/schema';
import { componentName, projectTexts } from '@/i18n/library';
import { useWorkspace } from '@/store/workspace';
import { BomView } from './BomView';
import { CalcCard, CircuitAnalysis, Playground } from './CalcView';
import { ErcPanel } from './ErcPanel';
import { useT } from './useT';

const LEVEL_STYLE = {
  info: 'bg-info-bg text-info-fg',
  warning: 'bg-warn-bg text-warn-fg',
  danger: 'bg-danger-bg text-danger-fg',
} as const;

/** Плитка кладки: заголовок-метка и содержимое; плитки не разбиваются между колонками. */
function Tile({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section
      className="card animate-fade-up mb-4 break-inside-avoid p-5"
      style={{ ['--i' as string]: Math.min(n, 8) }}
    >
      <p className="eyebrow mb-3">
        {String(n).padStart(2, '0')} · {title}
      </p>
      {children}
    </section>
  );
}

/**
 * Вкладка «Обзор»: описание, ERC, детали, предупреждения, расчёты и анализ цепи — плитками-кладкой (колонки по ширине окна),
 * чтобы не листать длинную ленту; список компонентов (BOM) — отдельным блоком на всю ширину.
 */
export function ProjectOverview({ board }: { board: BoardDef }) {
  const t = useT();
  const project = useWorkspace((s) => s.project);
  const projectId = useWorkspace((s) => s.projectId);
  const locale = useWorkspace((s) => s.locale);
  const texts = projectTexts(projectId, project, locale);
  let n = 0;

  return (
    <div className="glow-accent min-h-full">
      <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8">
        <div style={{ columnWidth: '24rem', columnGap: '1rem' }}>
          <Tile n={++n} title={t('overview.tab.overview')}>
            <h1 className="text-xl font-semibold tracking-tight">{texts.title}</h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">{texts.description}</p>
            {!board.verified && (
              <div
                className="bg-warn-bg text-warn-fg mt-3 rounded-lg px-3 py-2 text-xs"
                role="alert"
              >
                <strong>{t('board.unverified')}.</strong> {t('board.unverifiedHint')}
              </div>
            )}
            <dl className="border-line mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t pt-3 text-sm">
              <dt className="eyebrow">{t('overview.board')}</dt>
              <dd>
                {board.name} · {board.mcu} · {board.logicVoltage} V
              </dd>
              <dt className="eyebrow">{t('overview.power')}</dt>
              <dd>
                {project.power.source} · {project.power.voltage} V · {project.power.budgetMa} mA
              </dd>
            </dl>
          </Tile>

          <Tile n={++n} title={t('erc.title')}>
            <ErcPanel />
          </Tile>

          <Tile n={++n} title={t('overview.parts')}>
            <ul className="divide-line divide-y text-sm">
              {project.parts.map((p) => (
                <li key={p.instanceId} className="flex items-center gap-3 py-2">
                  <span className="w-14 shrink-0 font-mono text-xs">{p.instanceId}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {componentName(
                      p.componentId,
                      getComponent(p.componentId)?.name ?? p.componentId,
                      locale,
                    )}
                  </span>
                  {p.value && <span className="text-muted font-mono text-xs">{p.value}</span>}
                </li>
              ))}
            </ul>
          </Tile>

          <Tile n={++n} title={t('overview.warnings')}>
            {project.warnings.length === 0 ? (
              <p className="text-muted text-sm">{t('overview.noWarnings')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {project.warnings.map((w, i) => (
                  <li key={i} className={`rounded-lg px-3 py-2 text-sm ${LEVEL_STYLE[w.level]}`}>
                    {texts.warnings?.[i] ?? w.text}
                  </li>
                ))}
              </ul>
            )}
          </Tile>

          {project.calculations.map((c) => (
            <Tile key={c.id} n={++n} title={t('overview.tab.calc')}>
              <CalcCard calc={c} projectId={projectId} />
            </Tile>
          ))}

          <Tile n={++n} title={t('overview.tab.calc')}>
            <CircuitAnalysis board={board} />
          </Tile>

          <Tile n={++n} title={t('calc.playground')}>
            <Playground />
          </Tile>
        </div>

        <section className="card animate-fade-up mt-2 p-1 sm:p-2">
          <p className="eyebrow px-4 pt-4">
            {String(++n).padStart(2, '0')} · {t('overview.tab.parts')}
          </p>
          <BomView board={board} />
        </section>
      </div>
    </div>
  );
}
