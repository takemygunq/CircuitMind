import { beforeEach, describe, expect, it } from 'vitest';
import { selectBoard, useWorkspace } from './workspace';

const reset = () => useWorkspace.getState().setProject('weather-esp32');

describe('workspace store', () => {
  beforeEach(reset);

  it('switches projects and clears per-project state', () => {
    const s = useWorkspace.getState();
    s.moveItem('dht1', { x: 1, y: 1 });
    s.select({ kind: 'part', id: 'dht1' });
    s.setProject('blink-uno');
    const next = useWorkspace.getState();
    expect(next.project.boardId).toBe('arduino-uno');
    expect(next.overrides).toEqual({});
    expect(next.selection).toBeNull();
  });

  it('toggles group filters', () => {
    const s = useWorkspace.getState();
    s.toggleGroup('i2c');
    s.toggleGroup('power');
    expect(useWorkspace.getState().groupFilter).toEqual(['i2c', 'power']);
    s.toggleGroup('i2c');
    expect(useWorkspace.getState().groupFilter).toEqual(['power']);
    s.clearFilter();
    expect(useWorkspace.getState().groupFilter).toEqual([]);
  });

  it('resolves built-in boards and falls back to the fetched cache', () => {
    expect(selectBoard(useWorkspace.getState())?.id).toBe('esp32-devkit-v1');
    const state = {
      project: { ...useWorkspace.getState().project, boardId: 'custom' },
      boards: {},
    };
    expect(selectBoard(state)).toBeUndefined();
  });
});
