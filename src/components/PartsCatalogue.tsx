/* eslint-disable @next/next/no-img-element */
'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CatalogueItem } from '@/server/catalogue';
import { categoryLabel } from '@/i18n/library';
import type { Locale } from '@/i18n';
import { useWorkspace } from '@/store/workspace';
import { PartDetail } from './PartDetail';
import { useT } from './useT';

const PAGE = 48;

interface Page {
  total: number;
  all: number;
  items: CatalogueItem[];
  categories: { name: string; count: number }[];
  subs: { name: string; count: number }[];
}

/** Каталог деталей: поиск, разделы, подразделы, карточки с картинкой; «+» кладёт деталь в «Что у меня есть». */
export function PartsCatalogue() {
  const t = useT();
  const locale = useWorkspace((s) => s.locale);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [meta, setMeta] = useState<Omit<Page, 'items'> | null>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const catalogueOpen = useWorkspace((s) => s.catalogueOpen);
  const openCatalogue = useWorkspace((s) => s.openCatalogue);
  // переход из проекта: страница детали открывается сразу
  useEffect(() => {
    if (!catalogueOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenId(catalogueOpen);
    openCatalogue(null);
  }, [catalogueOpen, openCatalogue]);
  const seq = useRef(0);

  const load = async (offset: number) => {
    const my = ++seq.current;
    setLoading(true);
    const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE) });
    if (query.trim()) params.set('q', query.trim());
    if (category) params.set('category', category);
    if (sub) params.set('sub', sub);
    try {
      const res = await fetch(`/api/catalogue?${params}`);
      if (!res.ok || my !== seq.current) return;
      const page = (await res.json()) as Page;
      setItems((prev) => (offset ? [...prev, ...page.items] : page.items));
      setMeta(page);
    } catch {
      /* сеть недоступна — оставляем прежнюю выдачу */
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };

  // новый запрос → первая страница (поиск с небольшой задержкой)
  useEffect(() => {
    const timer = setTimeout(() => void load(0), query ? 220 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category, sub]);

  if (openId) return <PartDetail id={openId} onBack={() => setOpenId(null)} onOpen={setOpenId} />;

  return (
    <div className="glow-accent min-h-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8">
        <header className="animate-fade-up flex flex-col gap-4">
          <span className="eyebrow border-line bg-panel-2 w-fit rounded-md border px-2 py-1">
            {t('parts.eyebrow')}
          </span>
          <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">{t('parts.title')}</h1>
          <p className="text-muted max-w-xl">{t('parts.subtitle')}</p>
        </header>

        <div className="animate-fade-up flex flex-col gap-3" style={{ ['--i' as string]: 1 }}>
          <label className="relative block max-w-xl">
            <span className="sr-only">{t('parts.search')}</span>
            <Search
              size={16}
              className="text-muted pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('parts.search')}
              className="border-line bg-panel focus-visible:outline-accent w-full rounded-xl border py-3 pr-4 pl-10 text-sm focus-visible:outline-2"
            />
          </label>
          <Chips
            locale={locale}
            label={t('parts.groups')}
            allLabel={t('parts.all')}
            allCount={meta?.all}
            value={category}
            options={meta?.categories ?? []}
            onChange={(v) => {
              setCategory(v);
              setSub(null);
            }}
          />
          {category && meta && meta.subs.length > 1 && (
            <Chips
              locale={locale}
              label={t('parts.subgroups')}
              allLabel={t('parts.all')}
              allCount={meta.categories.find((c) => c.name === category)?.count}
              value={sub}
              options={meta.subs}
              onChange={setSub}
              small
            />
          )}
        </div>

        <p className="eyebrow">
          {meta ? t('parts.count', { shown: items.length, total: meta.total }) : '…'}
        </p>

        {meta && meta.total === 0 ? (
          <p className="text-muted py-12 text-center text-sm">{t('parts.empty')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {items.map((p, i) => {
              return (
                <li
                  key={p.id}
                  className="card card-hover animate-fade-up group relative flex flex-col overflow-hidden"
                  style={{ ['--i' as string]: Math.min(i % PAGE, 12) }}
                >
                  <div
                    className="bg-dots relative aspect-[4/3] cursor-pointer overflow-hidden"
                    onClick={() => setOpenId(p.id)}
                    style={{ backgroundColor: '#16161a' }}
                  >
                    {p.image && (
                      <img
                        src={p.image}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-contain p-2 transition-transform duration-500 group-hover:scale-110"
                      />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-4">
                    <span className="eyebrow !text-accent truncate">
                      {categoryLabel(p.category, locale)} · {categoryLabel(p.sub, locale)}
                    </span>
                    <h2 className="text-[15px] leading-snug font-medium">
                      <button
                        type="button"
                        onClick={() => setOpenId(p.id)}
                        className="hover:text-accent text-left"
                      >
                        {p.name}
                      </button>
                    </h2>
                    {p.brand && (
                      <span className="text-muted mt-auto pt-1 font-mono text-xs">{p.brand}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {meta && items.length < meta.total && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void load(items.length)}
            className="border-line bg-panel hover:bg-panel-2 focus-visible:outline-accent mx-auto rounded-full border px-6 py-2.5 text-sm font-medium focus-visible:outline-2 disabled:opacity-50"
          >
            {t('parts.more')}
          </button>
        )}

        <p className="text-muted border-line border-t pt-4 text-xs">{t('parts.source')}</p>
      </div>
    </div>
  );
}

function Chips({
  locale,
  label,
  allLabel,
  allCount,
  value,
  options,
  onChange,
  small = false,
}: {
  locale: Locale;
  label: string;
  allLabel: string;
  allCount?: number;
  value: string | null;
  options: { name: string; count: number }[];
  onChange: (v: string | null) => void;
  small?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {[{ name: null as string | null, count: allCount }, ...options].map((o) => {
        const on = value === o.name;
        return (
          <button
            key={o.name ?? 'all'}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.name)}
            className={`focus-visible:outline-accent rounded-full border transition-colors focus-visible:outline-2 ${small ? 'px-3 py-1 text-xs' : 'px-3.5 py-1.5 text-[13px]'} ${on ? 'border-fg bg-fg text-bg font-medium' : 'border-line bg-panel text-muted hover:text-fg'}`}
          >
            {o.name ? categoryLabel(o.name, locale) : allLabel}
            {o.count !== undefined && <span className="ml-1.5 opacity-60">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
