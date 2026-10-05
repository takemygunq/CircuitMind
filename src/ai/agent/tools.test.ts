import { describe, expect, it } from 'vitest';
import { weatherEsp32 } from '@/core/fixtures';
import { MemoryBoardStore } from '@/core/library/store';
import { compileBoardDraft } from '@/core/library/compile-draft';
import { makeNanoDraft } from '../__fixtures__/nano-draft';
import { checkProject, executeTool, toolDefinitions, TOOL_NAMES } from './tools';

const ctx = () => ({ store: new MemoryBoardStore() });
const parse = (s: string) => JSON.parse(s);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('toolDefinitions', () => {
  it('exposes the agent tools; ensure_board only when board generation is available', () => {
    const names = (canGenerateBoards: boolean) =>
      toolDefinitions({ canGenerateBoards }).map((t) => t.name);
    expect(names(false)).toEqual([
      'list_boards',
      'get_board',
      'search_components',
      'calculate',
      'create_project',
    ]);
    expect(names(true)).toContain('ensure_board');
    expect(TOOL_NAMES.every((n) => names(true).includes(n))).toBe(true);
  });

  it('uses closed schemas for strict tools and the Project schema for create_project', () => {
    const tools = Object.fromEntries(
      toolDefinitions({ canGenerateBoards: true }).map((t) => [t.name, t]),
    );
    for (const name of ['list_boards', 'get_board', 'search_components', 'ensure_board']) {
      expect(tools[name].strict, name).toBe(true);
      const schema = tools[name].input_schema as {
        additionalProperties?: boolean;
        required?: string[];
        properties?: object;
      };
      expect(schema.additionalProperties, name).toBe(false);
      expect(schema.required?.sort(), name).toEqual(Object.keys(schema.properties ?? {}).sort());
    }
    const schema = tools.create_project.input_schema as {
      type: string;
      properties: Record<string, unknown>;
      $schema?: string;
    };
    expect(schema.type).toBe('object');
    expect(schema.$schema).toBeUndefined();
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining([
        'title',
        'boardId',
        'parts',
        'connections',
        'power',
        'calculations',
        'bom',
        'warnings',
      ]),
    );
    expect(JSON.stringify(schema).length).toBeLessThan(12_000);
  });

  it('enables eager input streaming on every client tool', () => {
    for (const t of toolDefinitions({ canGenerateBoards: true }))
      expect((t as { eager_input_streaming?: boolean }).eager_input_streaming, t.name).toBe(true);
  });
});

describe('library tools', () => {
  it('list_boards includes built-in and generated boards', async () => {
    const c = ctx();
    await c.store.save(compileBoardDraft(makeNanoDraft()));
    const out = parse((await executeTool('list_boards', {}, c)).content);
    expect(out.boards.map((b: { id: string }) => b.id)).toEqual(
      expect.arrayContaining([
        'arduino-uno',
        'esp32-devkit-v1',
        'raspberry-pi-pico',
        'arduino-nano',
      ]),
    );
    expect(out.boards.find((b: { id: string }) => b.id === 'arduino-nano').verified).toBe(false);
  });

  it('get_board returns compact pins without coordinates and resolves aliases', async () => {
    const r = await executeTool('get_board', { boardId: 'esp32' }, ctx());
    expect(r.ok).toBe(true);
    const board = parse(r.content);
    expect(board.id).toBe('esp32-devkit-v1');
    expect(board.pins).toHaveLength(30);
    const p34 = board.pins.find((p: { id: string }) => p.id === 'GPIO34');
    expect(p34.flags).toContain('input_only');
    expect(JSON.stringify(board)).not.toContain('position');
    expect(board.rails[0].pinId).toBe('3V3');
  });

  it('get_board reports unknown boards with alternatives', async () => {
    const r = await executeTool('get_board', { boardId: 'nope' }, ctx());
    expect(r.ok).toBe(false);
    expect(parse(r.content).availableBoards).toContain('raspberry-pi-pico');
  });

  it('get_board warns about unverified AI boards', async () => {
    const c = ctx();
    await c.store.save(compileBoardDraft(makeNanoDraft()));
    expect(
      parse((await executeTool('get_board', { boardId: 'arduino-nano' }, c)).content).warning,
    ).toMatch(/not verified/);
  });

  it('search_components finds parts by words and category', async () => {
    const r = parse(
      (
        await executeTool(
          'search_components',
          { query: 'temperature humidity', category: null },
          ctx(),
        )
      ).content,
    );
    expect(r.components[0].id).toBe('dht22');
    expect(r.components[0].pins.map((p: { id: string }) => p.id)).toEqual([
      'VCC',
      'DATA',
      'NC',
      'GND',
    ]);
    const sensors = parse(
      (await executeTool('search_components', { query: '', category: 'sensor' }, ctx())).content,
    );
    expect(sensors.components.map((c: { id: string }) => c.id).sort()).toEqual([
      'dht22',
      'hc-sr04',
    ]);
  });

  it('search_components falls back to single words and explains misses', async () => {
    const some = parse(
      (await executeTool('search_components', { query: 'oled banana', category: null }, ctx()))
        .content,
    );
    expect(some.components.map((c: { id: string }) => c.id)).toContain('ssd1306-128x64-i2c');
    const none = parse(
      (await executeTool('search_components', { query: 'quantum flux', category: null }, ctx()))
        .content,
    );
    expect(none.components).toEqual([]);
    expect(none.note).toMatch(/categories/i);
  });
});

describe('calculate tool', () => {
  it('runs a calculator', async () => {
    const r = await executeTool(
      'calculate',
      { type: 'led_resistor', inputs: { vccV: 5, vfV: 2, ifMa: 20 } },
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(parse(r.content)).toMatchObject({ result: 150, unit: 'Ω', type: 'led_resistor' });
  });
  it('returns readable errors', async () => {
    const bad = await executeTool(
      'calculate',
      { type: 'led_resistor', inputs: { vccV: 1, vfV: 2, ifMa: 20 } },
      ctx(),
    );
    expect(bad.ok).toBe(false);
    expect(parse(bad.content).error).toMatch(/higher than/);
    expect((await executeTool('calculate', { type: 'nope', inputs: {} }, ctx())).ok).toBe(false);
    expect((await executeTool('calculate', { inputs: {} }, ctx())).ok).toBe(false);
  });
  it('rejects unknown tools', async () => {
    const r = await executeTool('rm_rf', {}, ctx());
    expect(r.ok).toBe(false);
    expect(parse(r.content).error).toMatch(/Unknown tool/);
  });
});

describe('ensure_board tool', () => {
  it('is unavailable without a generator', async () => {
    expect((await executeTool('ensure_board', { name: 'Arduino Nano' }, ctx())).ok).toBe(false);
  });
  it('generates a missing board and makes it usable', async () => {
    const c = { ...ctx(), generateBoardDraft: async () => makeNanoDraft() };
    const r = await executeTool('ensure_board', { name: 'Arduino Nano' }, c);
    expect(r.ok).toBe(true);
    expect(parse(r.content)).toMatchObject({
      status: 'generated',
      board: { id: 'arduino-nano', verified: false },
    });
    expect((await executeTool('get_board', { boardId: 'arduino-nano' }, c)).ok).toBe(true);
    expect(parse((await executeTool('ensure_board', { name: 'nano' }, c)).content).status).toBe(
      'found',
    );
  });
  it('reports generation failures with problems', async () => {
    const c = { ...ctx(), generateBoardDraft: async () => null };
    const r = await executeTool('ensure_board', { name: 'Mystery Board' }, c);
    expect(r.ok).toBe(false);
    expect(parse(r.content).problems.length).toBeGreaterThan(0);
  });
});

describe('checkProject', () => {
  it('accepts a correct project', async () => {
    const r = await checkProject(clone(weatherEsp32), ctx());
    expect(r.ok).toBe(true);
    expect(r.report?.counts.error).toBe(0);
  });
  it('returns schema problems', async () => {
    const r = await checkProject({ title: 'x' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/^schema: /);
  });
  it('rejects unknown boards, components and pins', async () => {
    expect(
      (await checkProject({ ...clone(weatherEsp32), boardId: 'nope' }, ctx())).problems[0],
    ).toMatch(/not in the library/);
    const comp = clone(weatherEsp32);
    comp.parts[0].componentId = 'ghost';
    expect((await checkProject(comp, ctx())).problems.join()).toMatch(/unknown component "ghost"/);
    const pin = clone(weatherEsp32);
    pin.connections[0].from = 'board:GPIO99';
    expect((await checkProject(pin, ctx())).problems.join()).toMatch(/has no pin "GPIO99"/);
    const partPin = clone(weatherEsp32);
    partPin.connections[0].to = 'dht1:NOPE';
    expect((await checkProject(partPin, ctx())).problems.join()).toMatch(/no pin "NOPE"/);
  });
  it('returns ERC errors as readable problems', async () => {
    const p = clone(weatherEsp32);
    p.parts = p.parts.filter((x) => x.instanceId !== 'R1');
    p.connections = p.connections.filter(
      (c) => !c.from.startsWith('R1:') && !c.to.startsWith('R1:') && c.from !== 'board:GPIO18',
    );
    p.connections.push({ from: 'board:GPIO18', to: 'led1:anode' });
    const r = await checkProject(p, ctx());
    expect(r.ok).toBe(false);
    expect(r.problems.some((s) => s.startsWith('[led_no_resistor]'))).toBe(true);
  });
  it('checks projects built on generated boards', async () => {
    const c = ctx();
    await c.store.save(compileBoardDraft(makeNanoDraft()));
    const nano = clone(weatherEsp32);
    nano.boardId = 'arduino-nano';
    nano.connections = [{ from: 'board:GPIO4', to: 'dht1:DATA' }];
    nano.parts = nano.parts.filter((p) => p.instanceId === 'dht1');
    const r = await checkProject(nano, c);
    expect(r.problems.join()).toMatch(/has no pin "GPIO4"/);
  });
});
