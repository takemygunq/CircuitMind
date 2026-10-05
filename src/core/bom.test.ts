import { describe, expect, it } from 'vitest';
import { bomKey, bomToCsv, bomTotals, compareBom, csvCell, deriveBom, initialOwned } from './bom';
import { blinkUno, weatherEsp32 } from './fixtures';
import { getBoard, getComponent } from './library';
import { Project } from './schema';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const lines = () => deriveBom(weatherEsp32, getBoard('esp32-devkit-v1'));

describe('deriveBom', () => {
  it('puts the board first and groups identical parts by component and value', () => {
    const l = lines();
    expect(l[0]).toMatchObject({
      isBoard: true,
      name: 'ESP32 DevKit V1 (30 pin)',
      qty: 1,
      unitUsd: 8,
    });
    const resistors = l.filter((x) => x.componentId === 'resistor');
    expect(resistors.map((r) => [r.value, r.refs])).toEqual([
      ['220', ['R1']],
      ['4.7k', ['Rpu']],
    ]);
    expect(l.reduce((s, x) => s + x.qty, 0)).toBe(1 + weatherEsp32.parts.length);
  });

  it('merges repeated parts and sums their price', () => {
    const p = clone(weatherEsp32);
    p.parts.push({ instanceId: 'R2', componentId: 'resistor', value: '220' });
    const r = deriveBom(p, getBoard('esp32-devkit-v1')).find(
      (x) => x.key === bomKey('resistor', '220'),
    )!;
    expect(r).toMatchObject({ qty: 2, refs: ['R1', 'R2'], unitUsd: 0.02, lineUsd: 0.04 });
  });

  it('keeps unknown components visible and unpriced', () => {
    const p = clone(weatherEsp32);
    p.parts.push({ instanceId: 'X1', componentId: 'ghost' });
    const l = deriveBom(p, getBoard('esp32-devkit-v1')).find((x) => x.componentId === 'ghost')!;
    expect(l).toMatchObject({ name: 'ghost', unverified: true });
    expect(l.unitUsd).toBeUndefined();
  });
});

describe('totals and ownership', () => {
  it('splits the total into owned and to-buy', () => {
    const l = lines();
    const all = bomTotals(l, new Set());
    expect(all.toBuyUsd).toBe(all.totalUsd);
    const dht = l.find((x) => x.componentId === 'dht22')!;
    const owned = bomTotals(l, new Set([dht.key, l[0].key]));
    expect(owned.ownedUsd).toBeCloseTo(3 + 8, 2);
    expect(owned.toBuyUsd).toBeCloseTo(all.totalUsd - 11, 2);
    expect(all.unpriced).toBe(0);
  });
  it('counts unpriced lines', () => {
    const p = clone(weatherEsp32);
    p.parts.push({ instanceId: 'X1', componentId: 'ghost' });
    expect(bomTotals(deriveBom(p, getBoard('esp32-devkit-v1')), new Set()).unpriced).toBe(1);
  });
  it('reads initial ownership from the AI bom', () => {
    const p = Project.parse({
      ...clone(blinkUno),
      bom: [
        { componentId: 'led-5mm-red', qty: 1, owned: true },
        { componentId: 'resistor', qty: 1, value: '150' },
      ],
    });
    expect([...initialOwned(p)]).toEqual([bomKey('led-5mm-red')]);
  });
});

describe('compareBom', () => {
  it('is empty when the AI list matches the parts', () => {
    expect(compareBom(weatherEsp32, lines())).toEqual([]);
  });
  it('finds missing, extra and miscounted entries', () => {
    const p = clone(weatherEsp32);
    p.bom = p.bom.filter((b) => b.componentId !== 'dht22');
    p.bom[1].qty = 3;
    p.bom.push({ componentId: 'servo-sg90', qty: 1 });
    const diff = compareBom(p, deriveBom(p, getBoard('esp32-devkit-v1')));
    expect(diff).toEqual(
      expect.arrayContaining([
        { key: bomKey('dht22'), expected: 1, declared: 0 },
        { key: bomKey('servo-sg90'), expected: 0, declared: 1 },
      ]),
    );
    expect(diff.some((d) => d.declared === 3)).toBe(true);
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(3)).toBe('3');
  });
  it('neutralises spreadsheet formulas', () => {
    for (const evil of ['=HYPERLINK("http://x","a")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd'])
      expect(csvCell(evil).replace(/^"/, '')).toMatch(/^'/);
  });
  it('writes a UTF-8 BOM, CRLF, header and one row per line', () => {
    const csv = bomToCsv(lines(), new Set());
    expect(
      csv.startsWith(
        '﻿Refs,Component,Value,Package,Qty,Unit price (USD),Line total (USD),Owned\r\n',
      ),
    ).toBe(true);
    const rows = csv.trimEnd().split('\r\n');
    expect(rows).toHaveLength(1 + lines().length);
    expect(rows[1]).toContain('ESP32 DevKit V1');
    expect(csv).toContain('R1,Резистор,220');
  });
  it('marks owned rows and localises headers', () => {
    const l = lines();
    const csv = bomToCsv(
      l,
      new Set([l[1].key]),
      {
        refs: 'Поз.',
        component: 'Компонент',
        value: 'Номинал',
        package: 'Корпус',
        qty: 'Кол-во',
        unit: 'Цена',
        line: 'Сумма',
        owned: 'Есть',
      },
      'да',
      'нет',
    );
    expect(csv).toContain('Поз.,Компонент');
    expect(csv.split('\r\n')[1]).toMatch(/нет\s*$/); // плата не отмечена
    expect(csv.split('\r\n')[2]).toMatch(/да\s*$/);
  });
  it('escapes hostile component names coming from AI projects', () => {
    const hostile = { ...getComponent('resistor')!, name: "=cmd|' /C calc'!A0" };
    const csv = bomToCsv(
      deriveBom(weatherEsp32, getBoard('esp32-devkit-v1'), () => hostile),
      new Set(),
    );
    expect(csv).not.toMatch(/,=cmd/);
    expect(csv).toContain("'=cmd");
  });
});
