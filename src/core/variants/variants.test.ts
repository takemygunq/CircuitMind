import { describe, expect, it } from 'vitest';
import { checkProject } from '@/ai/agent/tools';
import { mockVariantInputs } from '../fixtures';
import { getBoard } from '../library';
import { MemoryBoardStore } from '../library/store';
import { parseInventoryText, EMPTY_INVENTORY, type Inventory } from '../inventory';
import { checkVariants, draftToProject, sortVariants, type VariantCheckEnv } from './variants';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx = { store: new MemoryBoardStore() };
const env = (inventory: Inventory): VariantCheckEnv => ({
  inventory,
  checkProject: (p) => checkProject(p, ctx),
  getBoard: (id) => getBoard(id),
});
const set = (inputs = mockVariantInputs) => ({ variants: clone(inputs) });
const STOCK = parseInventoryText('arduino uno, светодиод, резистор 150'); // нет потенциометра
const RICH = parseInventoryText(
  'arduino uno, esp32, raspberry pi pico, 2 светодиода, резистор 150, резистор 220, резистор 4.7к, потенциометр, DHT22, OLED, кнопка',
);

describe('draftToProject', () => {
  it('builds a valid empty-calculations project from a draft', () => {
    const p = draftToProject(mockVariantInputs[1]);
    expect(p).toMatchObject({
      title: mockVariantInputs[1].title,
      boardId: 'arduino-uno',
      calculations: [],
      bom: [],
      warnings: [],
    });
    expect(p.parts).toHaveLength(3);
  });
});

describe('demo drafts', () => {
  it('all pass the ERC check as projects', async () => {
    for (const v of mockVariantInputs) {
      const r = await checkProject(draftToProject(v), ctx);
      expect(r.problems, v.id).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });
});

describe('checkVariants', () => {
  it('accepts every demo variant when the stock covers them, all marked as stock-only', async () => {
    const r = await checkVariants(set(), env(RICH));
    expect(r.problems).toEqual({});
    expect(r.general).toEqual([]);
    expect(r.accepted.map((v) => v.mode)).toEqual(['stock', 'stock', 'stock', 'stock']);
  });

  it('marks variants that need a small purchase and lists exactly what to buy', async () => {
    const r = await checkVariants(set(), env(STOCK));
    const byId = Object.fromEntries(r.accepted.map((v) => [v.id, v]));
    expect(byId['blink-uno']).toMatchObject({ mode: 'stock', fit: { fromStock: true, buy: [] } });
    expect(byId['dimmer-uno'].mode).toBe('purchase');
    expect(byId['dimmer-uno'].fit.buy.map((b) => b.componentId)).toEqual(['potentiometer-10k']);
    expect(byId['pico-pot-led'].fit.buy.map((b) => b.componentId).sort()).toEqual([
      'potentiometer-10k',
      'raspberry-pi-pico',
      'resistor',
    ]);
    expect(byId['pico-pot-led'].fit.costUsd).toBeCloseTo(4 + 0.4 + 0.02, 2);
    expect(byId['weather-esp32']).toBeUndefined(); // слишком много докупать
  });

  it('rejects a variant that needs too much extra hardware, with a useful message', async () => {
    const r = await checkVariants(set(), env(EMPTY_INVENTORY));
    expect(r.accepted.map((v) => v.id)).toEqual(
      ['blink-uno', 'dimmer-uno', 'pico-pot-led'].filter((id) =>
        r.accepted.some((v) => v.id === id),
      ),
    );
    // пустой инвентарь: у блинка ровно 3 позиции (плата, светодиод, резистор) — допустимо, у метеостанции 7 — нет
    expect(r.problems['weather-esp32'][0]).toMatch(/too much extra hardware/);
    expect(r.problems['weather-esp32'][0]).toContain('ESP32');
    expect(r.accepted.some((v) => v.id === 'weather-esp32')).toBe(false);
  });

  it('reports ERC problems of a draft against that variant only', async () => {
    const input = set();
    const led = input.variants.find((v) => v.id === 'blink-uno')!;
    led.draft.parts = led.draft.parts.filter((p) => p.instanceId !== 'R1');
    led.draft.connections = [
      { from: 'board:D13', to: 'led1:anode' },
      { from: 'led1:cathode', to: 'board:GND1' },
    ];
    const r = await checkVariants(input, env(STOCK));
    expect(r.problems['blink-uno'].some((p) => p.startsWith('[led_no_resistor]'))).toBe(true);
    expect(r.accepted.some((v) => v.id === 'blink-uno')).toBe(false);
    expect(r.accepted.length).toBeGreaterThanOrEqual(2);
  });

  it('reports unknown components and boards', async () => {
    const input = set();
    input.variants[0].draft.parts[0].componentId = 'ghost';
    input.variants[1].boardId = 'nope';
    const r = await checkVariants(input, env(STOCK));
    expect(r.problems[input.variants[0].id].join()).toMatch(/unknown component "ghost"/);
    expect(r.problems[input.variants[1].id].join()).toMatch(/not in the library|boardId/);
  });

  it('flags schema errors per variant id, duplicate ids and too few variants', async () => {
    const bad = set();
    bad.variants[0].difficulty = 9;
    const r1 = await checkVariants(bad, env(STOCK));
    expect(r1.problems['blink-uno'].join()).toContain('difficulty');
    const dup = set();
    dup.variants[1].id = dup.variants[0].id;
    expect((await checkVariants(dup, env(STOCK))).general.join()).toContain('duplicate variant id');
    const few = await checkVariants({ variants: [mockVariantInputs[0]] }, env(STOCK));
    expect(few.general.join()).toContain('at least 3');
    const garbage = await checkVariants({ nope: 1 }, env(STOCK));
    expect(garbage.accepted).toEqual([]);
    expect(garbage.general.join()).toContain('schema');
  });
});

describe('sortVariants', () => {
  it('puts stock-only variants first, then easier ones', async () => {
    const r = await checkVariants(set(), env(STOCK));
    const order = sortVariants(r.accepted).map((v) => `${v.mode}:${v.difficulty}`);
    expect(order).toEqual(['stock:1', 'purchase:2', 'purchase:2']);
  });
});
