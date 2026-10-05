import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { adapterFor } from '@/ai/providers/registry';
import {
  PROVIDER_KINDS,
  type ModelEntry,
  type ProviderConfig,
  type ProviderKind,
} from '@/ai/providers/types';
import { dataDir } from '../data-dir';
import { decryptSecret, encryptSecret, maskSecret } from './crypto';

const Check = z.object({ ok: z.boolean(), error: z.string().optional(), at: z.number() });
const Stored = z.object({
  id: z.string(),
  kind: z.enum(PROVIDER_KINDS),
  label: z.string(),
  apiKeyEnc: z.string().nullable(),
  apiKeyHint: z.string().nullable(),
  baseUrl: z.string().nullable(),
  models: z.array(z.object({ id: z.string(), label: z.string().optional() })),
  defaultModel: z.string().nullable(),
  enabled: z.boolean(),
  lastCheck: Check.nullable(),
  createdAt: z.number(),
});
type Stored = z.infer<typeof Stored>;
const Active = z.object({ providerId: z.string(), modelId: z.string() });
export type ActiveModel = z.infer<typeof Active>;
const File = z.object({ providers: z.array(Stored), active: Active.nullable() });
type FileData = z.infer<typeof File>;

/** То, что можно отдавать на фронт: без ключа. */
export interface ProviderView {
  id: string;
  kind: ProviderKind;
  label: string;
  apiKeyHint: string | null;
  baseUrl: string | null;
  models: ModelEntry[];
  defaultModel: string | null;
  enabled: boolean;
  lastCheck: z.infer<typeof Check> | null;
}

export class NotFoundError extends Error {}

const file = () => path.join(dataDir(), 'providers.json');

function read(): FileData {
  try {
    return File.parse(JSON.parse(fs.readFileSync(file(), 'utf8')));
  } catch {
    return { providers: [], active: null };
  }
}

/** Атомарная запись: во временный файл и переименование, права только владельцу. */
function write(data: FileData): void {
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

const toView = (r: Stored): ProviderView => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  apiKeyHint: r.apiKeyHint,
  baseUrl: r.baseUrl,
  models: r.models,
  defaultModel: r.defaultModel,
  enabled: r.enabled,
  lastCheck: r.lastCheck,
});

function find(data: FileData, id: string): Stored {
  const row = data.providers.find((p) => p.id === id);
  if (!row) throw new NotFoundError(`Provider ${id} not found`);
  return row;
}

export const listProviders = (): ProviderView[] => read().providers.map(toView);
export const getProvider = (id: string): ProviderView => toView(find(read(), id));
export const getActive = (): ActiveModel | null => read().active;

export function createProvider(input: {
  kind: ProviderKind;
  label: string;
  apiKey: string;
  baseUrl?: string;
  models?: ModelEntry[];
}): ProviderView {
  const data = read();
  const row: Stored = {
    id: crypto.randomUUID().slice(0, 8),
    kind: input.kind,
    label: input.label,
    apiKeyEnc: input.apiKey ? encryptSecret(input.apiKey) : null,
    apiKeyHint: input.apiKey ? maskSecret(input.apiKey) : null,
    baseUrl: input.baseUrl || null,
    models: input.models ?? [],
    defaultModel: null,
    enabled: true,
    lastCheck: null,
    createdAt: Date.now(),
  };
  data.providers.push(row);
  write(data);
  return toView(row);
}

export function updateProvider(
  id: string,
  patch: {
    label?: string;
    apiKey?: string;
    baseUrl?: string | null;
    models?: ModelEntry[];
    defaultModel?: string | null;
    enabled?: boolean;
  },
): ProviderView {
  const data = read();
  const row = find(data, id);
  if (patch.label !== undefined) row.label = patch.label;
  if (patch.apiKey) {
    row.apiKeyEnc = encryptSecret(patch.apiKey);
    row.apiKeyHint = maskSecret(patch.apiKey);
    row.lastCheck = null;
  }
  if (patch.baseUrl !== undefined) row.baseUrl = patch.baseUrl || null;
  if (patch.models !== undefined) row.models = patch.models;
  if (patch.defaultModel !== undefined) row.defaultModel = patch.defaultModel;
  if (row.defaultModel && !row.models.some((m) => m.id === row.defaultModel))
    row.defaultModel = null;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  write(data);
  return toView(row);
}

export function deleteProvider(id: string): void {
  const data = read();
  find(data, id);
  data.providers = data.providers.filter((p) => p.id !== id);
  if (data.active?.providerId === id) data.active = null;
  write(data);
}

/** Выбор модели, которой отвечают все режимы. null — вернуться к ключу из окружения. */
export function setActive(active: ActiveModel | null): void {
  const data = read();
  if (active) {
    const row = find(data, active.providerId);
    if (!row.enabled) throw new Error('The provider is disabled');
  }
  data.active = active;
  write(data);
}

/** Расшифрованная конфигурация — только для серверного кода. */
export function providerConfig(id: string): ProviderConfig {
  const row = find(read(), id);
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    apiKey: row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : '',
    baseUrl: row.baseUrl ?? undefined,
  };
}

export async function checkProvider(id: string): Promise<ProviderView> {
  const config = providerConfig(id);
  const result = await adapterFor(config.kind).healthCheck(config);
  const data = read();
  find(data, id).lastCheck = { ...result, at: Date.now() };
  write(data);
  return getProvider(id);
}

/** Подтягивает список моделей у провайдера и сохраняет его. */
export async function refreshModels(id: string): Promise<ProviderView> {
  const config = providerConfig(id);
  return updateProvider(id, { models: await adapterFor(config.kind).listModels(config) });
}
