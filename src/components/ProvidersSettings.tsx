'use client';

import {
  Bot,
  Check,
  Gem,
  Play,
  Route,
  Server,
  Sparkles,
  Terminal,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CLI_KINDS, KEYLESS_KINDS, PROVIDER_KINDS, type ProviderKind } from '@/ai/providers/types';
import type { MessageKey } from '@/i18n';
import type { ActiveModel, ProviderView } from '@/server/providers/store';
import { useT } from './useT';

const FIELD =
  'border-line bg-panel-2 text-fg placeholder:text-muted/60 focus-visible:outline-accent w-full rounded-lg border px-3 py-2 text-sm focus-visible:outline-2';
const BTN =
  'border-line bg-panel-2 hover:bg-panel focus-visible:outline-accent rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-2 disabled:opacity-40';
const PRIMARY =
  'btn-primary focus-visible:outline-accent px-4 py-2 text-sm focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-40';

const KIND_ICON: Record<ProviderKind, LucideIcon> = {
  anthropic: Sparkles,
  openai: Bot,
  gemini: Gem,
  openrouter: Route,
  ollama: Server,
  'claude-cli': Terminal,
  'codex-cli': Terminal,
  'gemini-cli': Terminal,
  demo: Play,
};

async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok)
    throw Object.assign(new Error(data.message ?? data.error ?? String(res.status)), {
      code: data.error,
    });
  return data;
}

/** Экран «Модели ИИ»: активная модель, подключённые провайдеры плитками и подключение нового (API, OpenRouter OAuth, Ollama, CLI-мосты). */
export function ProvidersSettings() {
  const t = useT();
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [active, setActive] = useState<ActiveModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = useCallback(
    (e: unknown) => {
      const code = (e as { code?: string }).code;
      setError(
        code === 'settings_local_only'
          ? t('prov.error.settings_local_only')
          : t('prov.error.generic', { message: e instanceof Error ? e.message : String(e) }),
      );
    },
    [t],
  );
  const reload = useCallback(async () => {
    try {
      const d = await api<{ providers: ProviderView[]; active: ActiveModel | null }>(
        '/api/providers',
      );
      setProviders(d.providers);
      setActive(d.active);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    // загрузка списка с сервера при открытии экрана
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    const q = new URLSearchParams(window.location.search);
    if (q.get('openrouter') === 'connected') setNotice(t('prov.orConnected'));
    else if (q.get('openrouter') === 'error')
      setError(t('prov.error.generic', { message: q.get('message') ?? '' }));
    if (q.has('openrouter')) window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const activeProvider = providers.find((p) => p.id === active?.providerId);

  return (
    <div className="glow-accent min-h-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8">
        <header className="animate-fade-up flex flex-col gap-4">
          <span className="eyebrow border-line bg-panel-2 w-fit rounded-md border px-2 py-1">
            {t('prov.eyebrow')}
          </span>
          <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">{t('prov.title')}</h1>
          <p className="text-muted max-w-2xl">{t('prov.subtitle')}</p>
        </header>

        {error && (
          <p role="alert" className="bg-danger-bg text-danger-fg rounded-xl px-4 py-3 text-sm">
            {error}
          </p>
        )}
        {notice && <p className="bg-info-bg text-info-fg rounded-xl px-4 py-3 text-sm">{notice}</p>}

        {/* активная модель */}
        <section
          className="card animate-fade-up relative flex flex-wrap items-center gap-4 overflow-hidden p-5"
          style={{ ['--i' as string]: 1 }}
          aria-label={t('prov.active')}
        >
          <div className="glow-accent pointer-events-none absolute inset-0" aria-hidden />
          <span className="bg-accent-soft text-accent relative grid h-12 w-12 place-items-center rounded-xl">
            <Sparkles size={22} />
          </span>
          <div className="relative min-w-0 flex-1">
            <p className="eyebrow">{t('prov.active')}</p>
            <p className="truncate text-xl font-semibold tracking-tight">
              {activeProvider && active
                ? `${activeProvider.label} · ${active.modelId}`
                : t('prov.activeEnv')}
            </p>
          </div>
          {active && (
            <button
              type="button"
              className={`${BTN} relative`}
              disabled={busy === 'env'}
              onClick={() => run('env', () => api('/api/settings/model', 'PUT', { active: null }))}
            >
              {t('prov.useEnv')}
            </button>
          )}
        </section>

        {/* подключённые провайдеры плитками */}
        <section aria-label={t('prov.connected')} className="flex flex-col gap-3">
          <p className="eyebrow">
            {t('prov.connected')} · {providers.length}
          </p>
          {providers.length === 0 ? (
            <p className="text-muted text-sm">{t('prov.none')}</p>
          ) : (
            <div style={{ columnWidth: '24rem', columnGap: '1rem' }}>
              {providers.map((p, i) => (
                <ProviderCard
                  key={p.id}
                  p={p}
                  index={i}
                  active={active}
                  busy={busy === p.id}
                  onAction={(fn) => run(p.id, fn)}
                />
              ))}
            </div>
          )}
        </section>

        <AddProvider
          onAdd={(input) =>
            run('add', async () => {
              const { provider } = await api<{ provider: ProviderView }>(
                '/api/providers',
                'POST',
                input,
              );
              // сразу проверяем и подтягиваем модели — провайдер готов за одно действие
              const checked = await api<{ provider: ProviderView }>(
                `/api/providers/${provider.id}/check`,
                'POST',
              );
              if (checked.provider.lastCheck?.ok)
                await api(`/api/providers/${provider.id}/models`, 'POST').catch(() => undefined);
            })
          }
          busy={busy === 'add'}
        />
      </div>
    </div>
  );
}

function ProviderCard({
  p,
  index,
  active,
  busy,
  onAction,
}: {
  p: ProviderView;
  index: number;
  active: ActiveModel | null;
  busy: boolean;
  onAction: (fn: () => Promise<unknown>) => void;
}) {
  const t = useT();
  const [model, setModel] = useState(
    p.defaultModel ?? (active?.providerId === p.id ? active.modelId : ''),
  );
  const [custom, setCustom] = useState('');
  const chosen = custom.trim() || model;
  const inUse = active?.providerId === p.id && active.modelId === chosen;
  const status = p.lastCheck;
  const Icon = KIND_ICON[p.kind];

  return (
    <article
      className={`card animate-fade-up mb-4 flex break-inside-avoid flex-col gap-4 p-5 ${active?.providerId === p.id ? 'border-accent/60' : ''}`}
      style={{ ['--i' as string]: Math.min(index + 2, 8) }}
    >
      <header className="flex items-start gap-3">
        <span className="bg-panel-2 text-fg grid h-10 w-10 shrink-0 place-items-center rounded-xl">
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{p.label}</h2>
          <p className="eyebrow truncate">
            {t(`prov.kind.${p.kind}` as MessageKey)}
            {p.apiKeyHint && <span className="ml-2 font-mono normal-case">{p.apiKeyHint}</span>}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${status ? (status.ok ? 'bg-info-bg text-info-fg' : 'bg-danger-bg text-danger-fg') : 'bg-panel-2 text-muted'}`}
        >
          {status ? (status.ok ? t('prov.ok') : '✕') : t('prov.notChecked')}
        </span>
      </header>
      {status && !status.ok && <p className="text-danger text-xs leading-snug">{status.error}</p>}

      <div className="flex flex-col gap-2">
        <label className="eyebrow" htmlFor={`m-${p.id}`}>
          {t('prov.model')}
        </label>
        <select
          id={`m-${p.id}`}
          className={FIELD}
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setCustom('');
          }}
        >
          <option value="">{t('prov.modelNone')}</option>
          {p.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id}
            </option>
          ))}
        </select>
        <input
          className={FIELD}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={t('prov.addModel')}
          aria-label={t('prov.addModel')}
          maxLength={200}
        />
        <button
          type="button"
          className={`${PRIMARY} flex items-center justify-center gap-2`}
          disabled={busy || !chosen || inUse || !p.enabled}
          onClick={() =>
            onAction(async () => {
              if (!p.models.some((m) => m.id === chosen))
                await api(`/api/providers/${p.id}`, 'PATCH', {
                  models: [...p.models, { id: chosen }],
                  defaultModel: chosen,
                });
              else await api(`/api/providers/${p.id}`, 'PATCH', { defaultModel: chosen });
              await api('/api/settings/model', 'PUT', {
                active: { providerId: p.id, modelId: chosen },
              });
            })
          }
        >
          {inUse && <Check size={15} strokeWidth={2.6} />}
          {inUse ? t('prov.inUse') : t('prov.use')}
        </button>
      </div>

      <footer className="border-line flex flex-wrap items-center gap-2 border-t pt-3">
        <button
          type="button"
          className={BTN}
          disabled={busy}
          onClick={() => onAction(() => api(`/api/providers/${p.id}/check`, 'POST'))}
        >
          {t('prov.check')}
        </button>
        <button
          type="button"
          className={BTN}
          disabled={busy}
          onClick={() => onAction(() => api(`/api/providers/${p.id}/models`, 'POST'))}
        >
          {t('prov.fetchModels')}
        </button>
        <label className="text-muted ml-auto flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={p.enabled}
            className="accent-accent"
            onChange={(e) =>
              onAction(() => api(`/api/providers/${p.id}`, 'PATCH', { enabled: e.target.checked }))
            }
          />
          {t('prov.enabled')}
        </label>
        <button
          type="button"
          className="text-muted hover:text-danger grid h-8 w-8 place-items-center rounded-lg"
          disabled={busy}
          aria-label={t('prov.delete')}
          title={t('prov.delete')}
          onClick={() => onAction(() => api(`/api/providers/${p.id}`, 'DELETE'))}
        >
          <Trash2 size={15} />
        </button>
      </footer>
    </article>
  );
}

function AddProvider({
  onAdd,
  busy,
}: {
  onAdd: (input: { kind: ProviderKind; label: string; apiKey: string; baseUrl?: string }) => void;
  busy: boolean;
}) {
  const t = useT();
  const [kind, setKind] = useState<ProviderKind>('anthropic');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const needsKey = !KEYLESS_KINDS.includes(kind);
  const isCli = CLI_KINDS.includes(kind);
  const name = label.trim() || t(`prov.kind.${kind}` as MessageKey);

  return (
    <section
      className="card animate-fade-up flex flex-col gap-5 p-5"
      style={{ ['--i' as string]: 3 }}
      aria-label={t('prov.add')}
    >
      <p className="eyebrow">{t('prov.add')}</p>

      <div
        role="radiogroup"
        aria-label={t('prov.kind')}
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
      >
        {PROVIDER_KINDS.map((k) => {
          const Icon = KIND_ICON[k];
          const on = kind === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setKind(k)}
              className={`focus-visible:outline-accent flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] transition-colors focus-visible:outline-2 ${on ? 'border-accent bg-accent-soft font-medium' : 'border-line bg-panel-2 text-muted hover:text-fg'}`}
            >
              <Icon size={16} className={on ? 'text-accent shrink-0' : 'shrink-0'} />
              <span className="leading-tight">{t(`prov.kind.${k}` as MessageKey)}</span>
            </button>
          );
        })}
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onAdd({ kind, label: name, apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || undefined });
          setApiKey('');
          setLabel('');
          setBaseUrl('');
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">{t('prov.label')}</span>
            <input
              className={FIELD}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={60}
              placeholder={t(`prov.kind.${kind}` as MessageKey)}
            />
          </label>
          {needsKey && (
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">{t('prov.apiKey')}</span>
              <input
                className={`${FIELD} font-mono`}
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                maxLength={500}
              />
            </label>
          )}
          {kind !== 'demo' && (
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="eyebrow">{isCli ? t('prov.cliPath') : t('prov.baseUrl')}</span>
              <input
                className={FIELD}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                maxLength={500}
              />
            </label>
          )}
        </div>
        <p className="text-muted text-sm">{t(`prov.help.${kind}` as MessageKey)}</p>
        {isCli && <p className="text-muted text-xs">{t('prov.cliNote')}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={PRIMARY} disabled={busy || (needsKey && !apiKey.trim())}>
            {t('prov.connect')}
          </button>
          {kind === 'openrouter' && (
            <a href="/api/openrouter/login" className={BTN}>
              {t('prov.signInOpenRouter')}
            </a>
          )}
        </div>
      </form>
    </section>
  );
}
