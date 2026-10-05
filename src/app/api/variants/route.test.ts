import { beforeEach, describe, expect, it } from 'vitest';
import type { VariantsEvent } from '@/ai/variants/events';
import { parseInventoryText } from '@/core/inventory';
import { POST, variantsLimiter } from './route';

const call = (body: unknown, ip = '3.3.3.3') =>
  POST(
    new Request('http://localhost/api/variants', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
const events = async (res: Response): Promise<VariantsEvent[]> =>
  (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const inventory = parseInventoryText('arduino uno, светодиод, резистор 150, потенциометр');

describe('POST /api/variants (mock AI)', () => {
  beforeEach(() => {
    process.env.CIRCUITMIND_MOCK_AI = '1';
    variantsLimiter.reset();
  });

  it('streams events and finishes with variants', async () => {
    const res = await call({ inventory, locale: 'ru' });
    expect(res.status).toBe(200);
    const list = await events(res);
    expect(list[0]).toMatchObject({ type: 'start', model: 'mock-model' });
    const done = list.at(-1) as Extract<VariantsEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.result.variants.length).toBeGreaterThanOrEqual(3);
  });

  it('serves repeated requests from the cache', async () => {
    await events(await call({ inventory, wish: 'кэш' }));
    const second = await events(await call({ inventory, wish: 'кэш' }));
    expect(second[0]).toMatchObject({ type: 'start', cached: true });
  });

  it('validates input', async () => {
    expect((await call('not json')).status).toBe(400);
    expect((await call({ inventory: { items: [], unknown: [] } })).status).toBe(400);
    expect((await call({ inventory: { items: [{ kind: 'part' }] } })).status).toBe(400);
    expect((await call('x'.repeat(50_000))).status).toBe(413);
  });

  it('rate limits per address', async () => {
    for (let i = 0; i < 4; i++) await call({ inventory, wish: `w${i}` });
    expect((await call({ inventory })).status).toBe(429);
    expect((await call({ inventory }, '4.4.4.4')).status).toBe(200);
  });
});
