import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { scriptedClient, textBlock } from '@/ai/agent/scripted';
import { ollamaAdapter, openaiAdapter } from '@/ai/providers/openai';
import { DELETE, PATCH } from '@/app/api/providers/[id]/route';
import { GET, POST } from '@/app/api/providers/route';
import { GET as getModel, PUT as putModel } from '@/app/api/settings/model/route';
import { decryptSecret, encryptSecret } from './crypto';
import { resolveModel } from './resolve';
import { createProvider, getActive, listProviders, providerConfig, setActive } from './store';

let dir: string;
let stub: http.Server;
let baseUrl: string;
const requests: { url: string; auth?: string; body: Record<string, unknown> }[] = [];
let reply: unknown = {};

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests.push({
        url: req.url ?? '',
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : {},
      });
      res.setHeader('content-type', 'application/json');
      if (req.url?.endsWith('/models'))
        res.end(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'gpt-5', object: 'model' },
              { id: 'text-embedding-3', object: 'model' },
            ],
          }),
        );
      else res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/v1`;
});
afterAll(() => stub.close());

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-data-'));
  process.env.CIRCUITMIND_DATA_DIR = dir;
  delete process.env.CIRCUITMIND_MOCK_AI;
  delete process.env.CIRCUITMIND_ALLOW_REMOTE_SETTINGS;
  requests.length = 0;
});

const call = (url: string, init?: RequestInit) => new Request(`http://localhost:3000${url}`, init);
const json = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

describe('secret encryption and store', () => {
  it('encrypts keys at rest and never lists them', () => {
    expect(decryptSecret(encryptSecret('sk-secret-1234'))).toBe('sk-secret-1234');
    const p = createProvider({ kind: 'openai', label: 'My OpenAI', apiKey: 'sk-secret-1234' });
    expect(p.apiKeyHint).toBe('••••1234');
    const raw = fs.readFileSync(path.join(dir, 'providers.json'), 'utf8');
    expect(raw).not.toContain('sk-secret-1234');
    expect(JSON.stringify(listProviders())).not.toContain('sk-secret');
    expect(providerConfig(p.id).apiKey).toBe('sk-secret-1234');
    if (process.platform !== 'win32')
      expect(fs.statSync(path.join(dir, 'secret.key')).mode & 0o077).toBe(0);
  });

  it('keeps the active model valid when providers change', () => {
    const p = createProvider({ kind: 'ollama', label: 'Local', apiKey: '' });
    setActive({ providerId: p.id, modelId: 'llama3' });
    expect(getActive()).toEqual({ providerId: p.id, modelId: 'llama3' });
    expect(() => setActive({ providerId: 'nope', modelId: 'x' })).toThrow();
  });
});

describe('/api/providers', () => {
  it('creates, patches, selects and deletes a provider', async () => {
    const created = await (
      await POST(
        json('POST', '/api/providers', {
          kind: 'openai',
          label: 'OpenAI',
          apiKey: 'sk-abcdef1234',
        }),
      )
    ).json();
    const id = created.provider.id as string;
    expect(JSON.stringify(created)).not.toContain('sk-abcdef');
    const ctx = { params: Promise.resolve({ id }) };
    const patched = await (
      await PATCH(
        json('PATCH', `/api/providers/${id}`, { models: [{ id: 'gpt-5' }], defaultModel: 'gpt-5' }),
        ctx,
      )
    ).json();
    expect(patched.provider.defaultModel).toBe('gpt-5');
    const sel = await putModel(
      json('PUT', '/api/settings/model', { active: { providerId: id, modelId: 'gpt-5' } }),
    );
    expect((await sel.json()).active).toEqual({ providerId: id, modelId: 'gpt-5' });
    expect((await (await GET(call('/api/providers'))).json()).providers).toHaveLength(1);
    await DELETE(json('DELETE', `/api/providers/${id}`), ctx);
    expect((await (await getModel(call('/api/settings/model'))).json()).active).toBeNull();
  });

  it('validates input: key required, CLI path without spaces', async () => {
    expect(
      (await POST(json('POST', '/api/providers', { kind: 'openai', label: 'x' }))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          json('POST', '/api/providers', {
            kind: 'claude-cli',
            label: 'x',
            baseUrl: 'claude --dangerously',
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(json('POST', '/api/providers', { kind: 'claude-cli', label: 'Claude Code' })))
        .status,
    ).toBe(200);
    expect((await POST(json('POST', '/api/providers', { kind: 'nope', label: 'x' }))).status).toBe(
      400,
    );
  });

  it('is local-only and same-origin by default', async () => {
    const remote = new Request('http://example.com/api/providers');
    expect((await GET(remote)).status).toBe(403);
    const cross = json(
      'POST',
      '/api/providers',
      { kind: 'demo', label: 'd' },
      { origin: 'http://evil.example' },
    );
    expect((await POST(cross)).status).toBe(403);
    process.env.CIRCUITMIND_ALLOW_REMOTE_SETTINGS = '1';
    expect((await GET(remote)).status).toBe(200);
  });
});

describe('model resolution', () => {
  const mock = () => scriptedClient([{ content: [textBlock('demo')] }], 'mock-model');

  it('uses the mock for demo mode and the Demo provider', () => {
    process.env.CIRCUITMIND_MOCK_AI = '1';
    expect(resolveModel({ mock }).kind).toBe('mock');
    delete process.env.CIRCUITMIND_MOCK_AI;
    const d = createProvider({ kind: 'demo', label: 'Demo', apiKey: '' });
    setActive({ providerId: d.id, modelId: 'demo' });
    expect(resolveModel({ mock }).kind).toBe('mock');
  });

  it('falls back to the environment key without a selection', () => {
    expect(resolveModel({ mock }).kind).toBe('env');
  });

  it('talks to an OpenAI-compatible server with tools and gets tool_use back', async () => {
    reply = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'c9',
                type: 'function',
                function: { name: 'calculate', arguments: '{"type":"led_resistor"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    };
    const p = createProvider({ kind: 'openai', label: 'Stub', apiKey: 'sk-test-0000', baseUrl });
    setActive({ providerId: p.id, modelId: 'gpt-5' });
    const r = resolveModel({ mock, maxTokens: 777 });
    expect(r.kind).toBe('openai');
    expect(r.client.model).toBe('openai:gpt-5');
    const msg = await r.client.turn({
      system: 'SYS',
      tools: [
        { name: 'calculate', description: 'd', input_schema: { type: 'object', properties: {} } },
      ] as never,
      messages: [{ role: 'user', content: 'go' }],
    });
    expect(msg.stop_reason).toBe('tool_use');
    expect(msg.content[0]).toMatchObject({
      type: 'tool_use',
      id: 'c9',
      name: 'calculate',
      input: { type: 'led_resistor' },
    });
    const sent = requests.at(-1)!;
    expect(sent.auth).toBe('Bearer sk-test-0000');
    expect(sent.body).toMatchObject({ model: 'gpt-5', max_completion_tokens: 777 });
    expect((sent.body.tools as unknown[]).length).toBe(1);
  });

  it('structured JSON for board drafts goes through response_format', async () => {
    reply = { choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] };
    const model = openaiAdapter.createModel(
      { id: 'x', kind: 'openai', label: 'x', apiKey: 'k', baseUrl },
      'gpt-5',
    );
    expect(await model.askJson({ system: 's', prompt: 'p', schema: { type: 'object' } })).toBe(
      '{"ok":true}',
    );
    expect(requests.at(-1)!.body.response_format).toMatchObject({ type: 'json_schema' });
  });

  it('lists models (hiding non-chat ones) and checks health', async () => {
    const cfg = { id: 'x', kind: 'openai' as const, label: 'x', apiKey: 'k', baseUrl };
    expect((await openaiAdapter.listModels(cfg)).map((m) => m.id)).toEqual(['gpt-5']);
    expect(await openaiAdapter.healthCheck(cfg)).toEqual({ ok: true });
    const dead = await ollamaAdapter.healthCheck({
      id: 'o',
      kind: 'ollama',
      label: 'o',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:9/v1',
    });
    expect(dead.ok).toBe(false);
    expect(dead.error).toContain('ollama serve');
  });
});
