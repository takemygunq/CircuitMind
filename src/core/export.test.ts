import { describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_BYTES,
  exportFilename,
  parseProjectJson,
  projectToJson,
  slugify,
} from './export';
import { weatherEsp32 } from './fixtures';

describe('slugify / filenames', () => {
  it('transliterates Cyrillic and strips symbols', () => {
    expect(slugify('Мини-метеостанция на ESP32')).toBe('mini-meteostantsiya-na-esp32');
    expect(slugify('Світлодіодний ліхтар «Ї»')).toBe('svitlodiodniy-likhtar-yi');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
  });
  it('falls back for empty or unsupported titles', () => {
    expect(slugify('!!!')).toBe('circuitmind-project');
    expect(slugify('日本語')).toBe('circuitmind-project');
  });
  it('limits the length and builds names', () => {
    expect(slugify('a'.repeat(200)).length).toBe(60);
    expect(exportFilename(weatherEsp32, 'bom', 'csv')).toBe('mini-meteostantsiya-na-esp32-bom.csv');
    expect(exportFilename({ title: 'X' }, '', 'json')).toBe('x.json');
  });
});

describe('project JSON round-trip', () => {
  it('exports and re-imports an identical project', () => {
    const r = parseProjectJson(projectToJson(weatherEsp32));
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.project).toEqual(weatherEsp32);
  });
  it('accepts a UTF-8 BOM', () => {
    expect(parseProjectJson('﻿' + projectToJson(weatherEsp32)).ok).toBe(true);
  });
  it('rejects bad input with a reason', () => {
    expect(parseProjectJson('nope')).toEqual({ ok: false, error: 'not_json' });
    expect(parseProjectJson('x'.repeat(MAX_IMPORT_BYTES + 1))).toEqual({
      ok: false,
      error: 'too_large',
    });
    const bad = parseProjectJson('{"title":"x"}');
    expect(bad).toMatchObject({ ok: false, error: 'invalid_project' });
    if (!bad.ok) expect(bad.issues!.length).toBeGreaterThan(0);
  });
  it('strips unknown keys instead of trusting them', () => {
    const r = parseProjectJson(
      JSON.stringify({ ...weatherEsp32, __proto__: { polluted: true }, extra: 1 }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project).not.toHaveProperty('extra');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
