/* eslint-disable @next/next/no-img-element */
'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { categoryLabel } from '@/i18n/library';
import type { CatalogueItem } from '@/server/catalogue';
import { useWorkspace } from '@/store/workspace';
import { useT } from './useT';

type Tab = 'overview' | 'alternates';

const TYPE_STYLE: Record<string, string> = {
  power: 'bg-[#d6321e] text-white',
  ground: 'bg-[#16161a] text-white ring-1 ring-white/20',
  gnd: 'bg-[#16161a] text-white ring-1 ring-white/20',
  gpio: 'bg-[#3aa04a] text-white',
  analog: 'bg-[#2f7d3a] text-white',
  uart: 'bg-[#6b4fc0] text-white',
  control: 'bg-[#e49aa6] text-black',
};
const badge = (type?: string) =>
  TYPE_STYLE[type ?? ''] ?? 'bg-transparent text-fg ring-1 ring-current/40';

/** Логическая распиновка: чип в центре, выводы пилюлями слева и справа (физическое расположение не показываем). */
function PinoutDiagram({
  pins,
  title,
}: {
  pins: NonNullable<CatalogueItem['pins']>;
  title: string;
}) {
  const left = pins.filter((_, i) => i % 2 === 0);
  const right = pins.filter((_, i) => i % 2 === 1);
  const pill = (p: (typeof pins)[number], i: number) => (
    <span
      key={i}
      className={`truncate rounded px-2 py-1 text-center font-mono text-[11px] font-semibold ${badge(p.type)}`}
      title={p.label}
    >
      {p.label}
    </span>
  );
  return (
    <div className="grid grid-cols-[1fr_88px_1fr] items-stretch gap-3" aria-label={title}>
      <div className="flex flex-col gap-1.5">{left.map(pill)}</div>
      <div className="border-line bg-panel-2 flex items-center justify-center rounded-xl border px-1 py-6 [writing-mode:vertical-rl]">
        <span className="eyebrow">{title}</span>
      </div>
      <div className="flex flex-col gap-1.5">{right.map(pill)}</div>
    </div>
  );
}

/** Страница детали: хлебные крошки, фото, описание, свойства и вкладка «Аналоги». */
export function PartDetail({
  id,
  onBack,
  onOpen,
}: {
  id: string;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const locale = useWorkspace((s) => s.locale);
  const [data, setData] = useState<
    { part: CatalogueItem; alternates: CatalogueItem[] } | null | 'missing'
  >(null);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    let live = true;
    fetch(`/api/catalogue/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : 'missing'))
      .then((d) => live && (setData(d), setTab('overview')))
      .catch(() => live && setData('missing'));
    return () => {
      live = false;
    };
  }, [id]);

  if (data === 'missing')
    return (
      <div className="mx-auto max-w-5xl px-5 py-10">
        <button type="button" onClick={onBack} className="text-muted text-sm underline">
          {t('parts.back')}
        </button>
        <p className="mt-6">{t('parts.empty')}</p>
      </div>
    );
  if (!data) return <div className="text-muted p-10 text-sm">{t('common.loading')}</div>;
  const { part, alternates } = data;

  return (
    <div className="glow-accent min-h-full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-8 sm:px-8">
        <nav
          className="eyebrow flex flex-wrap items-center gap-2"
          aria-label={t('parts.breadcrumb')}
        >
          <button
            type="button"
            onClick={onBack}
            className="hover:text-fg inline-flex items-center gap-1.5"
          >
            <ArrowLeft size={13} /> {t('parts.eyebrow')}
          </button>
          <span>/</span>
          <span>{categoryLabel(part.category, locale)}</span>
          <span>/</span>
          <span>{categoryLabel(part.sub, locale)}</span>
        </nav>

        <header className="animate-fade-up flex flex-col gap-5">
          <h1 className="max-w-3xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
            {part.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {part.source && (
              <a
                href={part.source}
                target="_blank"
                rel="noreferrer noopener"
                className="border-line bg-panel hover:bg-panel-2 inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm"
              >
                {t('parts.openSource')} <ExternalLink size={14} />
              </a>
            )}
          </div>
        </header>

        <div role="tablist" className="border-line flex gap-6 border-b">
          {(['overview', 'alternates'] as const).map((id2) => (
            <button
              key={id2}
              role="tab"
              type="button"
              aria-selected={tab === id2}
              onClick={() => setTab(id2)}
              className={`eyebrow -mb-px border-b-2 pb-3 transition-colors ${tab === id2 ? 'border-accent !text-accent' : 'hover:text-fg border-transparent'}`}
            >
              {t(`parts.tab.${id2}` as 'parts.tab.overview')}
              {id2 === 'alternates' && ` · ${alternates.length}`}
            </button>
          ))}
        </div>

        {tab === 'overview' ? (
          <div className="animate-fade-up grid gap-8 lg:grid-cols-[1fr_280px]">
            <div
              className="bg-dots border-line flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl border"
              style={{ backgroundColor: '#fff' }}
            >
              {part.image && (
                <img
                  src={part.image}
                  alt={part.name}
                  className="h-full w-full object-contain p-4"
                />
              )}
            </div>
            <aside className="flex flex-col gap-5">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                {part.brand && (
                  <>
                    <dt className="eyebrow">{t('parts.brand')}</dt>
                    <dd>{part.brand}</dd>
                  </>
                )}
                {part.sku && (
                  <>
                    <dt className="eyebrow">SKU</dt>
                    <dd className="font-mono">{part.sku}</dd>
                  </>
                )}
                <dt className="eyebrow">{t('parts.category')}</dt>
                <dd>
                  {categoryLabel(part.category, locale)} / {categoryLabel(part.sub, locale)}
                </dd>
              </dl>
              {part.description && (
                <p className="text-muted text-sm leading-relaxed">{part.description}</p>
              )}
              {part.offers && part.offers.length > 0 && (
                <section aria-label={t('parts.offers')}>
                  <h2 className="eyebrow mb-2">{t('parts.offers')}</h2>
                  <ul className="divide-line border-line divide-y border-y">
                    {part.offers.map((o, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span>{o.vendor}</span>
                        <span className="flex items-center gap-2 font-mono text-xs">
                          {o.price !== undefined &&
                            `${!o.currency || o.currency === 'USD' ? '$' : `${o.currency} `}${o.price.toFixed(2)}`}
                          {o.url && (
                            <a
                              href={o.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-muted hover:text-accent"
                              aria-label={o.vendor}
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          </div>
        ) : alternates.length === 0 ? (
          <p className="text-muted text-sm">{t('parts.noAlternates')}</p>
        ) : (
          <ul className="animate-fade-up grid grid-cols-2 gap-4 md:grid-cols-3">
            {alternates.map((a) => (
              <li key={a.id} className="card card-hover overflow-hidden">
                <button
                  type="button"
                  onClick={() => onOpen(a.id)}
                  className="flex w-full flex-col text-left"
                >
                  <div className="flex aspect-[4/3] items-center justify-center bg-white">
                    {a.image && (
                      <img
                        src={a.image}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-contain p-2"
                      />
                    )}
                  </div>
                  <div className="flex flex-col gap-1 p-3">
                    <span className="text-[14px] leading-snug font-medium">{a.name}</span>
                    {a.brand && <span className="text-muted font-mono text-xs">{a.brand}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {tab === 'overview' && part.pins && part.pins.length > 0 && (
          <section
            className="animate-fade-up grid gap-8 lg:grid-cols-2"
            aria-label={t('parts.pinDetails')}
          >
            <div className="flex flex-col gap-3">
              <p className="eyebrow">{t('parts.logicalPinout')}</p>
              <PinoutDiagram pins={part.pins} title={part.name.slice(0, 28)} />
            </div>
            <div>
              <div className="border-line mb-2 flex items-baseline justify-between border-b pb-2">
                <h2 className="font-semibold">{t('parts.pinDetails')}</h2>
                <span className="eyebrow">{t('parts.connections', { n: part.pins.length })}</span>
              </div>
              <ul className="divide-line divide-y">
                {part.pins.map((p, i) => (
                  <li key={i} className="flex flex-col gap-1.5 py-3">
                    <span
                      className={`w-fit rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${badge(p.type)}`}
                    >
                      {p.label}
                    </span>
                    {p.function && <p className="text-muted text-sm leading-snug">{p.function}</p>}
                    {p.voltage && <p className="eyebrow !normal-case">{p.voltage}</p>}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
