import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { mockVariantInputs } from '@/core/fixtures';
import { parseInventoryText } from '@/core/inventory';
import { MemoryBoardStore } from '@/core/library/store';
import { scriptedClient, textBlock, toolUse, type TurnScript } from '../agent/scripted';
import type { VariantsEvent } from './events';
import { createMockVariantsClient } from './mock';
import { runVariantsAgent, variantToolDefinitions } from './run';
import { VARIANTS_SYSTEM_PROMPT, inventoryBrief, variantsUserMessage } from './prompt';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const RICH = parseInventoryText(
  'arduino uno, esp32, raspberry pi pico, 2 светодиода, резистор 150, резистор 220, резистор 4.7к, потенциометр, DHT22, OLED, кнопка',
);
const POOR = parseInventoryText('arduino uno, светодиод, резистор 150');

function run(
  script: TurnScript[],
  inventory = RICH,
  extra: { maxRepairs?: number; signal?: AbortSignal } = {},
) {
  const client = scriptedClient(script);
  const events: VariantsEvent[] = [];
  const promise = runVariantsAgent({
    client,
    ctx: { store: new MemoryBoardStore() },
    request: { inventory, locale: 'ru' },
    emit: (e) => events.push(e),
    ...extra,
  });
  return { client, events, promise };
}
const submit = (variants = clone(mockVariantInputs)) => ({
  content: [toolUse('suggest_variants', { variants })],
});
const lastUser = (c: ReturnType<typeof scriptedClient>, i: number) =>
  c.requests[i].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];

describe('tool definitions', () => {
  it('offers library tools plus suggest_variants, without project creation', () => {
    expect(variantToolDefinitions().map((t) => t.name)).toEqual([
      'list_boards',
      'get_board',
      'search_components',
      'calculate',
      'suggest_variants',
    ]);
    const schema = variantToolDefinitions().at(-1)!.input_schema as {
      properties: { variants: { maxItems: number } };
    };
    expect(schema.properties.variants.maxItems).toBe(8);
  });
});

describe('runVariantsAgent', () => {
  it('accepts a clean set on the first try, sorted with stock-only variants first', async () => {
    const { promise, events } = run([submit()]);
    const r = await promise;
    expect(r).toMatchObject({ ok: true, repairs: 0, rejected: [], general: [] });
    expect(r.variants.map((v) => v.id).sort()).toEqual([
      'blink-uno',
      'dimmer-uno',
      'pico-pot-led',
      'weather-esp32',
    ]);
    expect(r.variants.every((v) => v.mode === 'stock')).toBe(true);
    expect(events.find((e) => e.type === 'check')).toMatchObject({
      attempt: 1,
      rejected: [],
      accepted: expect.arrayContaining(['blink-uno']),
    });
  });

  it('sends the inventory and library tools in the first request', async () => {
    const { promise, client } = run([submit()]);
    await promise;
    const prompt = String(client.requests[0].messages[0].content);
    expect(prompt).toContain('Arduino Uno R3');
    expect(prompt).toContain('component id "potentiometer-10k"');
    expect(prompt).toContain('Russian');
    expect(client.requests[0].system).toBe(VARIANTS_SYSTEM_PROMPT);
  });

  it('feeds problems back (too much extra hardware, ERC) and accepts the repaired list', async () => {
    const broken = clone(mockVariantInputs);
    const blink = broken.find((v) => v.id === 'blink-uno')!;
    blink.draft.parts = blink.draft.parts.filter((p) => p.instanceId !== 'R1');
    blink.draft.connections = [
      { from: 'board:D13', to: 'led1:anode' },
      { from: 'led1:cathode', to: 'board:GND1' },
    ];
    const { promise, client, events } = run(
      [submit(broken), submit(clone(mockVariantInputs).filter((v) => v.id !== 'weather-esp32'))],
      POOR,
    );
    const r = await promise;
    expect(r.repairs).toBe(1);
    const feedback = lastUser(client, 1)[0];
    expect(feedback.is_error).toBe(true);
    const body = JSON.parse(String(feedback.content));
    expect(
      body.problemsByVariant['blink-uno'].some((p: string) => p.startsWith('[led_no_resistor]')),
    ).toBe(true);
    expect(body.problemsByVariant['weather-esp32'][0]).toContain('too much extra hardware');
    expect(body.accepted).toEqual(expect.arrayContaining(['dimmer-uno']));
    expect(body.instruction).toContain('COMPLETE');
    expect(events).toContainEqual({ type: 'repair', attempt: 1, max: 2 });
  });

  it('after the repair budget returns what works and reports the rest', async () => {
    const { promise, client } = run([submit()], POOR);
    const r = await promise;
    expect(client.requests).toHaveLength(3); // попытка + 2 исправления
    expect(r.variants.map((v) => v.id).sort()).toEqual(['blink-uno', 'dimmer-uno', 'pico-pot-led']);
    expect(r.rejected.map((x) => x.id)).toEqual(['weather-esp32']);
    expect(r.ok).toBe(true);
    expect(r.variants[0].mode).toBe('stock');
  });

  it('reports ok=false when fewer than 3 variants survive', async () => {
    const r = await run([submit([mockVariantInputs[0], mockVariantInputs[3]] as never)], POOR, {
      maxRepairs: 0,
    }).promise;
    expect(r.ok).toBe(false);
    expect(r.variants.map((v) => v.id)).toEqual(['blink-uno']);
    expect(r.general.join()).toContain('at least 3');
  });

  it('keeps the best attempt even if a later one is worse', async () => {
    const worse = [mockVariantInputs[0]];
    const r = await run([submit(), submit(worse as never), submit(worse as never)], POOR).promise;
    expect(r.variants.length).toBe(3);
  });

  it('runs library tools in parallel with the final call and survives bad tool calls', async () => {
    const { promise, client } = run([
      {
        content: [
          toolUse('list_boards', {}),
          toolUse('search_components', { query: 'led', category: null }),
          toolUse('delete_everything', {}),
        ],
      },
      submit(),
    ]);
    const r = await promise;
    expect(r.ok).toBe(true);
    const results = lastUser(client, 1);
    expect(results).toHaveLength(3);
    expect(results[2].is_error).toBe(true);
    expect(String(results[2].content)).toContain('Unknown tool');
  });

  it('handles truncation, a forgotten tool call, refusal, budget and abort', async () => {
    const t = run([
      { content: [toolUse('suggest_variants', { variants: [] })], stopReason: 'max_tokens' },
      submit(),
    ]);
    expect((await t.promise).ok).toBe(true);
    expect(String(lastUser(t.client, 1)[0].content)).toContain('cut off');
    expect((await run([{ content: [textBlock('Идеи...')] }, submit()]).promise).ok).toBe(true);
    await expect(run([{ content: [textBlock('нет')] }]).promise).rejects.toMatchObject({
      code: 'no_project',
    });
    await expect(run([{ content: [], stopReason: 'refusal' }]).promise).rejects.toMatchObject({
      code: 'refused',
    });
    await expect(
      run([{ content: [toolUse('list_boards', {})], usage: { output: 500_000 } }]).promise,
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
    const ac = new AbortController();
    ac.abort();
    await expect(run([submit()], RICH, { signal: ac.signal }).promise).rejects.toThrow();
  });
});

describe('prompts', () => {
  it('describes the inventory for the model', () => {
    const brief = inventoryBrief(
      parseInventoryText('3 светодиода, резистор 220 x5, ESP32, паяльник'),
    );
    expect(brief).toContain('3× Светодиод 5 мм красный (component id "led-5mm-red")');
    expect(brief).toContain('5× Резистор 220 Ω (component id "resistor", value "220")');
    expect(brief).toContain('board id "esp32-devkit-v1"');
    expect(brief).toContain('паяльник');
    expect(inventoryBrief({ items: [], unknown: [] })).toContain('owns nothing');
  });
  it('includes wishes and language', () => {
    const msg = variantsUserMessage({ inventory: RICH, wish: ' что-то со светом ', locale: 'uk' });
    expect(msg).toContain('что-то со светом');
    expect(msg).toContain('Ukrainian');
  });
  it('encodes the key rules', () => {
    for (const phrase of [
      '3 to 6',
      'at most 3 extra items',
      'calculate',
      'COMPLETE',
      'Electrical Rules Check',
    ])
      expect(VARIANTS_SYSTEM_PROMPT).toContain(phrase);
  });
});

describe('mock variants client', () => {
  it('walks through tools, a check and the final answer', async () => {
    const events: VariantsEvent[] = [];
    const r = await runVariantsAgent({
      client: createMockVariantsClient(),
      ctx: { store: new MemoryBoardStore() },
      request: { inventory: POOR, locale: 'ru' },
      emit: (e) => events.push(e),
    });
    expect(r.model).toBe('mock-model');
    expect(r.variants.length).toBe(3);
    expect(events.filter((e) => e.type === 'check').length).toBeGreaterThanOrEqual(1);
  });
});
