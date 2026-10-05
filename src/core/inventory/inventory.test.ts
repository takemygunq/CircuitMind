import { describe, expect, it } from 'vitest';
import { bomKey, deriveBom } from '../bom';
import { blinkUno, weatherEsp32 } from '../fixtures';
import { getBoard } from '../library';
import {
  EMPTY_INVENTORY,
  Inventory,
  addItem,
  compareToInventory,
  haveQty,
  itemKey,
  itemLabel,
  ownedFromInventory,
  parseInventoryText,
  removeItem,
  setQty,
} from './inventory';

const pick = (inv: Inventory) =>
  inv.items.map((i) => `${i.kind}:${i.id}${i.value ? `=${i.value}` : ''}×${i.qty}`).sort();

describe('parseInventoryText', () => {
  it('understands a mixed Russian list with quantities, resistors and boards', () => {
    const inv = parseInventoryText(
      '2 светодиода красных, резистор 220 ом x5, 10к x3, ESP32, DHT22, arduino uno',
    );
    expect(pick(inv)).toEqual([
      'board:arduino-uno×1',
      'board:esp32-devkit-v1×1',
      'part:dht22×1',
      'part:led-5mm-red×2',
      'part:resistor=10k×3',
      'part:resistor=220×5',
    ]);
    expect(inv.unknown).toEqual([]);
  });

  it('understands English and different quantity styles', () => {
    const inv = parseInventoryText('3x LED\n5 pcs resistor 330\nbutton x4; servo 2 шт; HC-SR04');
    expect(pick(inv)).toEqual([
      'part:button-6mm×4',
      'part:hc-sr04×1',
      'part:led-5mm-red×3',
      'part:resistor=330×5',
      'part:servo-sg90×2',
    ]);
  });

  it('normalises resistor values (кОм, запятая, МОм)', () => {
    expect(pick(parseInventoryText('4,7к, 1M, 100 ом, резистор 2.2k'))).toEqual([
      'part:resistor=100×1',
      'part:resistor=1M×1',
      'part:resistor=2.2k×1',
      'part:resistor=4.7k×1',
    ]);
  });

  it('merges duplicates and keeps unknown text out of the stock', () => {
    const inv = parseInventoryText('светодиод, светодиод x2, паяльник, ');
    expect(pick(inv)).toEqual(['part:led-5mm-red×3']);
    expect(inv.unknown).toEqual(['паяльник']);
  });

  it('prefers the more specific component and handles tricky words', () => {
    expect(pick(parseInventoryText('модуль реле'))).toEqual(['part:relay-module-1ch×1']);
    expect(pick(parseInventoryText('OLED дисплей 0.96'))).toEqual(['part:ssd1306-128x64-i2c×1']);
    expect(pick(parseInventoryText('raspberry pi pico'))).toEqual(['board:raspberry-pi-pico×1']);
    expect(pick(parseInventoryText('резистор'))).toEqual(['part:resistor×1']);
  });

  it('caps absurd quantities and ignores empty input', () => {
    expect(parseInventoryText('').items).toEqual([]);
    const absurd = parseInventoryText('5000 светодиодов');
    expect(absurd.items).toEqual([]); // слишком много цифр — не количество
    expect(absurd.unknown).toEqual(['5000 светодиодов']);
    expect(Inventory.safeParse(parseInventoryText('999 светодиодов')).success).toBe(true);
  });
});

describe('inventory editing', () => {
  const inv = addItem(
    addItem(EMPTY_INVENTORY, { kind: 'part', id: 'resistor', value: '220', qty: 2 }),
    { kind: 'board', id: 'arduino-uno', qty: 1 },
  );
  it('keys match BOM keys and add merges quantities', () => {
    expect(itemKey({ kind: 'part', id: 'resistor', value: '220' })).toBe(bomKey('resistor', '220'));
    expect(itemKey({ kind: 'board', id: 'arduino-uno' })).toBe('board:arduino-uno');
    expect(
      haveQty(
        addItem(inv, { kind: 'part', id: 'resistor', value: '220', qty: 3 }),
        bomKey('resistor', '220'),
      ),
    ).toBe(5);
    expect(haveQty(inv, bomKey('resistor', '330'))).toBe(0);
  });
  it('sets quantity and removes at zero', () => {
    expect(haveQty(setQty(inv, bomKey('resistor', '220'), 7), bomKey('resistor', '220'))).toBe(7);
    expect(setQty(inv, bomKey('resistor', '220'), 0).items).toHaveLength(1);
    expect(removeItem(inv, 'board:arduino-uno').items).toHaveLength(1);
    expect(
      haveQty(addItem(inv, { kind: 'board', id: 'arduino-uno', qty: 999 }), 'board:arduino-uno'),
    ).toBe(999);
  });
  it('labels items for humans', () => {
    expect(itemLabel({ kind: 'part', id: 'resistor', value: '4.7k', qty: 1 })).toBe(
      'Резистор 4.7 kΩ',
    );
    expect(itemLabel({ kind: 'board', id: 'arduino-uno', qty: 1 })).toBe('Arduino Uno R3');
    expect(itemLabel({ kind: 'part', id: 'ghost', qty: 1 })).toBe('ghost');
  });
});

describe('compareToInventory', () => {
  const uno = getBoard('arduino-uno')!;
  it('reports a project that is fully covered by the stock', () => {
    const inv = parseInventoryText('arduino uno, светодиод, резистор 150');
    const fit = compareToInventory(blinkUno, uno, inv);
    expect(fit).toMatchObject({ fromStock: true, buy: [], costUsd: 0 });
    expect(fit.coverage['board:arduino-uno']).toEqual([1, 1]);
  });
  it('lists missing parts with prices; a resistor of the wrong value counts as missing', () => {
    const inv = parseInventoryText('arduino uno, светодиод, резистор 330');
    const fit = compareToInventory(blinkUno, uno, inv);
    expect(fit.fromStock).toBe(false);
    expect(fit.buy).toEqual([
      expect.objectContaining({
        componentId: 'resistor',
        value: '150',
        qty: 1,
        unitUsd: 0.02,
        lineUsd: 0.02,
      }),
    ]);
    expect(fit.costUsd).toBe(0.02);
  });
  it('counts quantities and the board price', () => {
    const esp = getBoard('esp32-devkit-v1')!;
    const fit = compareToInventory(
      weatherEsp32,
      esp,
      parseInventoryText('светодиод, кнопка, резистор 220'),
    );
    expect(fit.buy.map((b) => b.key).sort()).toEqual(
      [
        'board:esp32-devkit-v1',
        bomKey('dht22'),
        bomKey('resistor', '4.7k'),
        bomKey('ssd1306-128x64-i2c'),
      ].sort(),
    );
    expect(fit.buy.find((b) => b.isBoard)).toMatchObject({ unitUsd: 8, qty: 1 });
    expect(fit.costUsd).toBeCloseTo(8 + 3 + 0.02 + 3, 2);
    expect(
      compareToInventory(
        weatherEsp32,
        esp,
        addItem(parseInventoryText('светодиод'), {
          kind: 'part',
          id: 'resistor',
          value: '220',
          qty: 1,
        }),
      ).coverage[bomKey('resistor', '220')],
    ).toEqual([1, 1]);
  });
  it('flags items without a price', () => {
    const p = JSON.parse(JSON.stringify(blinkUno));
    p.parts.push({ instanceId: 'X', componentId: 'ghost' });
    const fit = compareToInventory(p, uno, EMPTY_INVENTORY);
    expect(fit.unpriced).toBe(1);
  });
});

describe('ownedFromInventory', () => {
  it('marks BOM lines the stock fully covers', () => {
    const lines = deriveBom(weatherEsp32, getBoard('esp32-devkit-v1'));
    const owned = ownedFromInventory(
      lines,
      parseInventoryText('esp32, 2 светодиода, DHT22, резистор 220'),
    );
    expect([...owned].sort()).toEqual(
      [
        'board:esp32-devkit-v1',
        bomKey('dht22'),
        bomKey('led-5mm-red'),
        bomKey('resistor', '220'),
      ].sort(),
    );
  });
});
