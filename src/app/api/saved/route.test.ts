import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { blinkUno } from '@/core/fixtures';
import { DELETE, GET as getOne } from './[id]/route';
import { GET, POST } from './route';

const req = (method: string, url = '/api/saved', body?: unknown) =>
  new Request(`http://localhost:3000${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('/api/saved', () => {
  beforeEach(() => {
    process.env.CIRCUITMIND_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-saved-'));
  });

  it('saves, lists, overwrites, loads and deletes', async () => {
    const { saved } = await (await POST(req('POST', '/api/saved', { project: blinkUno }))).json();
    expect(saved.title).toBe(blinkUno.title);
    await POST(
      req('POST', '/api/saved', { project: { ...blinkUno, title: 'Renamed' }, id: saved.id }),
    );
    const list = (await (await GET(req('GET'))).json()).projects;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Renamed');
    expect((await (await getOne(req('GET'), ctx(saved.id))).json()).project.title).toBe('Renamed');
    expect((await DELETE(req('DELETE'), ctx(saved.id))).status).toBe(200);
    expect((await getOne(req('GET'), ctx(saved.id))).status).toBe(404);
  });

  it('rejects invalid projects and path-like ids', async () => {
    expect((await POST(req('POST', '/api/saved', { project: { title: 'x' } }))).status).toBe(400);
    expect(
      (await POST(req('POST', '/api/saved', { project: blinkUno, id: '../../etc' }))).status,
    ).toBe(400);
    expect((await getOne(req('GET'), ctx('../../x'))).status).toBe(404);
  });

  it('is local-only', async () => {
    expect((await GET(new Request('http://example.com/api/saved'))).status).toBe(403);
  });
});
