import { describe, expect, it } from 'vitest';
import { components } from '@/core/library';
import { renderComponentArt } from './render';

describe.each(components.map((c) => [c.id, c] as const))('%s', (_id, def) => {
  const art = renderComponentArt(def, def.kind === 'resistor' ? '4.7k' : undefined);
  it('renders finite SVG', () => {
    expect(art.svg.length).toBeGreaterThan(50);
    expect(art.svg).not.toMatch(/NaN|undefined|Infinity/);
  });
  it('has a wire exit for every pin', () => {
    for (const p of def.pins) expect(art.exits[p.id], p.id).toBeDefined();
  });
  it('bbox contains every pin', () => {
    for (const p of def.pins) {
      expect(p.position.x).toBeGreaterThanOrEqual(art.bbox.x);
      expect(p.position.x).toBeLessThanOrEqual(art.bbox.x + art.bbox.w);
      expect(p.position.y).toBeGreaterThanOrEqual(art.bbox.y);
      expect(p.position.y).toBeLessThanOrEqual(art.bbox.y + art.bbox.h);
    }
  });
});

describe('resistor', () => {
  it('draws colour bands from its value', () => {
    const def = components.find((c) => c.id === 'resistor')!;
    expect(renderComponentArt(def, '220').svg).toContain('#d62828'); // красный
    expect(renderComponentArt(def, '4.7k').svg).toContain('#f2d400'); // жёлтый
  });
});

it('escapes names of generic components', () => {
  const def = { ...components[0], kind: undefined, name: '<script>x</script>' };
  expect(renderComponentArt(def).svg).not.toContain('<script');
});
