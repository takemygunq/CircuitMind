import { describe, expect, it } from 'vitest';
import { PART_GROUPS, connectorsCatalogue, findCataloguePart, searchCatalogue } from './connectors';

describe('connectors & cables catalogue', () => {
  it('has unique ids and a sane size', () => {
    const ids = connectorsCatalogue.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(150);
    for (const p of connectorsCatalogue) {
      expect(p.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(PART_GROUPS).toContain(p.group);
      expect(p.priceUsd).toBeGreaterThan(0);
    }
  });

  it('covers every group and every illustration', () => {
    for (const g of PART_GROUPS) expect(connectorsCatalogue.some((p) => p.group === g)).toBe(true);
    const images = new Set(connectorsCatalogue.map((p) => p.image));
    expect(images.size).toBeGreaterThanOrEqual(7);
  });

  it('searches by words in name and tags within a group', () => {
    expect(searchCatalogue('female 2x20').length).toBeGreaterThan(0);
    expect(searchCatalogue('usb-c').every((p) => /usb/i.test(p.name))).toBe(true);
    expect(searchCatalogue('jumper', 'wires').length).toBeGreaterThan(3);
    expect(searchCatalogue('jumper', 'power')).toEqual([]);
    expect(findCataloguePart(connectorsCatalogue[0].id)).toBe(connectorsCatalogue[0]);
  });
});
