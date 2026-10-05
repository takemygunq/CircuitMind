import { describe, expect, it } from 'vitest';
import type { AgentEvent } from './events';
import { NdjsonParser } from './ndjson';
import { buildTimeline } from './timeline';

describe('NdjsonParser', () => {
  it('reassembles events split across chunks and skips heartbeats', () => {
    const p = new NdjsonParser();
    expect(p.push('{"type":"start","model":"m"}\n{"type":"tu')).toEqual([
      { type: 'start', model: 'm' },
    ]);
    expect(p.push('rn","n":1}\n\n')).toEqual([{ type: 'turn', n: 1 }]);
    expect(p.push('{"type":"text","delta":"hi"}')).toEqual([]);
    expect(p.flush()).toEqual([{ type: 'text', delta: 'hi' }]);
    expect(p.flush()).toEqual([]);
  });
  it('ignores garbage and objects without a type', () => {
    const p = new NdjsonParser();
    expect(p.push('not json\n{"a":1}\n[]\n{"type":"turn","n":2}\n')).toEqual([
      { type: 'turn', n: 2 },
    ]);
  });
  it('handles Cyrillic split mid-stream by whole chunks', () => {
    const p = new NdjsonParser();
    const line = JSON.stringify({ type: 'text', delta: 'Привет, мир' }) + '\n';
    expect(p.push(line.slice(0, 20))).toEqual([]);
    expect(p.push(line.slice(20))).toEqual([{ type: 'text', delta: 'Привет, мир' }]);
  });
});

describe('buildTimeline', () => {
  const events: AgentEvent[] = [
    { type: 'start', model: 'm' },
    { type: 'turn', n: 1 },
    { type: 'text', delta: 'Подбираю ' },
    { type: 'text', delta: 'плату' },
    { type: 'tool', id: 't1', name: 'get_board', status: 'running', summary: 'esp32' },
    { type: 'tool', id: 't1', name: 'get_board', status: 'ok', summary: 'ESP32 DevKit' },
    { type: 'turn', n: 2 },
    { type: 'tool', id: 't2', name: 'create_project', status: 'running', summary: 'x' },
    { type: 'erc', attempt: 1, ok: false, errors: 1, warnings: 0, items: [], problems: [] },
    { type: 'tool', id: 't2', name: 'create_project', status: 'error' },
    { type: 'repair', attempt: 1, max: 3 },
  ];
  it('merges tool updates in place and keeps order', () => {
    const t = buildTimeline(events);
    expect(t.rows.map((r) => r.kind)).toEqual(['start', 'tool', 'tool', 'erc', 'repair']);
    expect(t.rows[1]).toMatchObject({ id: 't1', status: 'ok', summary: 'ESP32 DevKit' });
    expect(t.rows[2]).toMatchObject({ id: 't2', status: 'error', summary: 'x' });
    expect(t.turn).toBe(2);
    expect(t.finished).toBe(false);
  });
  it('shows the latest model note per turn and truncates it', () => {
    expect(buildTimeline(events.slice(0, 4)).note).toBe('Подбираю плату');
    expect(buildTimeline(events.slice(0, 7)).note).toBe('');
    expect(buildTimeline([{ type: 'text', delta: 'x'.repeat(500) }]).note).toHaveLength(160);
  });
  it('marks finished on done / error', () => {
    expect(buildTimeline([{ type: 'error', code: 'timeout', message: 'slow' }])).toMatchObject({
      finished: true,
    });
    const done = buildTimeline([{ type: 'done', result: { ok: true } as never }]);
    expect(done.finished).toBe(true);
    expect(done.rows[0].kind).toBe('done');
  });
});
