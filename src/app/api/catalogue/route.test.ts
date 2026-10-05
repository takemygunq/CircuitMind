import { describe, expect, it } from 'vitest';
import { GET } from './route';

const call = (qs = '') => GET(new Request(`http://localhost/api/catalogue${qs}`));

describe('GET /api/catalogue', () => {
  it('returns a page with categories and counts', async () => {
    const body = await (await call('?limit=10')).json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(10);
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);
    expect(body.categories.length).toBeGreaterThan(0);
    expect(body.items[0]).toMatchObject({ id: expect.any(String), name: expect.any(String) });
  });

  it('filters by category and query, and paginates', async () => {
    const all = await (await call('?limit=96')).json();
    const cat = all.categories[0].name as string;
    const inCat = await (await call(`?category=${encodeURIComponent(cat)}&limit=96`)).json();
    expect(inCat.items.every((p: { category: string }) => p.category === cat)).toBe(true);
    expect(inCat.subs.length).toBeGreaterThan(0);
    const none = await (await call('?q=zzzz-no-such-part-zzzz')).json();
    expect(none.total).toBe(0);
    const page2 = await (await call('?limit=5&offset=5')).json();
    const page1 = await (await call('?limit=5&offset=0')).json();
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
  });

  it('rejects bad parameters', async () => {
    expect((await call('?limit=9999')).status).toBe(400);
    expect((await call('?offset=-1')).status).toBe(400);
  });
});
