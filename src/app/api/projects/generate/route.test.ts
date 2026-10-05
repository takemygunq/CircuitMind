import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '@/ai/agent/events';
import { blinkUno } from '@/core/fixtures';
import { parseInventoryText } from '@/core/inventory';
import { userMessage } from '@/ai/agent/system-prompt';
import { generationLimiter } from '@/server/generation-instance';
import { POST } from './route';

const call = (body: unknown, ip = '1.1.1.1') =>
  POST(
    new Request('http://localhost/api/projects/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }),
  );

async function events(res: Response): Promise<AgentEvent[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('POST /api/projects/generate (mock AI)', () => {
  beforeEach(() => {
    process.env.CIRCUITMIND_MOCK_AI = '1';
    generationLimiter.reset();
  });

  it('streams NDJSON events ending with a validated project', async () => {
    const res = await call({ prompt: 'weather station on ESP32 for my balcony', locale: 'ru' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const list = await events(res);
    expect(list[0]).toMatchObject({ type: 'start', model: 'mock-model' });
    const ercs = list.filter((e): e is Extract<AgentEvent, { type: 'erc' }> => e.type === 'erc');
    expect(ercs.map((e) => e.ok)).toEqual([false, true]);
    expect(list.some((e) => e.type === 'repair')).toBe(true);
    const done = list.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.result.ok).toBe(true);
    expect(done.result.project?.boardId).toBe('esp32-devkit-v1');
  });

  it('validates the request', async () => {
    expect((await call({ prompt: 'x' })).status).toBe(400);
    expect((await call({ prompt: 'a long enough prompt', locale: 'de' })).status).toBe(400);
    const bad = await call({ prompt: 'a long enough prompt', boardId: 'nope' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'unknown_board' });
  });

  it('rate limits per address', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await call({ prompt: `device number ${i} please`, locale: 'en' }, '9.9.9.9');
      expect(res.status).toBe(200);
      await events(res); // дочитываем поток: запуск завершается и освобождает слот
    }
    const res = await call({ prompt: 'one more device please', locale: 'en' }, '9.9.9.9');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    const other = await call({ prompt: 'another address is fine', locale: 'en' }, '8.8.8.8');
    expect(other.status).toBe(200);
    await events(other);
  });

  it('reports a missing API key as ai_not_configured', async () => {
    process.env.CIRCUITMIND_MOCK_AI = '0';
    // чистый каталог данных: настройки провайдеров разработчика не должны влиять на тест
    process.env.CIRCUITMIND_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-gen-'));
    const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      const res = await call({ prompt: 'a prompt without any key set', locale: 'en' });
      const isStream = res.headers.get('content-type')?.includes('ndjson');
      const last = (isStream ? (await events(res)).at(-1) : await res.json()) as {
        code?: string;
        error?: string;
      };
      expect(last.code ?? last.error).toBe('ai_not_configured');
    } finally {
      if (saved.key) process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.token) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
    }
  });
});

describe('seeded generation (from Mode 2)', () => {
  beforeEach(() => {
    process.env.CIRCUITMIND_MOCK_AI = '1';
    generationLimiter.reset();
  });

  it('develops the chosen draft instead of a fresh design', async () => {
    const list = await events(
      await call({
        prompt: 'Blink an LED',
        seed: blinkUno,
        inventory: parseInventoryText('arduino uno, светодиод, резистор 220'),
      }),
    );
    const done = list.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.result.ok).toBe(true);
    expect(done.result.project?.boardId).toBe('arduino-uno');
  });

  it('puts the draft and the inventory into the prompt', () => {
    const msg = userMessage({
      prompt: 'x',
      locale: 'en',
      seed: blinkUno,
      inventory: parseInventoryText('3 светодиода'),
    });
    expect(msg).toContain('"boardId":"arduino-uno"');
    expect(msg).toContain('3× ');
    expect(userMessage({ prompt: 'x', locale: 'en' })).not.toContain('Draft');
  });
});
