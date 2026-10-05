import { describe, expect, it } from 'vitest';
import { weatherEsp32 } from '@/core/fixtures';
import { getBoard } from '@/core/library';
import { renderPinoutSvg, renderWiringSvg } from './export-svg';

const board = getBoard('esp32-devkit-v1')!;

describe('renderWiringSvg', () => {
  const { svg, width, height } = renderWiringSvg(weatherEsp32, board, { background: true });
  it('is a standalone, finite SVG', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(svg).not.toContain('var(--');
    expect(width).toBeGreaterThan(200);
    expect(height).toBeGreaterThan(200);
    expect(Math.max(width, height)).toBeLessThanOrEqual(8192);
  });
  it('draws every wire and every part', () => {
    expect(svg.match(/class="wire"/g)).toHaveLength(weatherEsp32.connections.length);
    for (const p of weatherEsp32.parts) expect(svg).toContain(`data-part="${p.instanceId}"`);
    expect(svg).toContain('Мини-метеостанция');
  });
  it('can omit the background and switch the theme', () => {
    const light = renderWiringSvg(weatherEsp32, board).svg;
    expect(light).not.toContain('fill="#ffffff"/>');
    expect(renderWiringSvg(weatherEsp32, board, { theme: 'dark', background: true }).svg).toContain(
      '#10161e',
    );
  });
  it('honours moved parts', () => {
    const moved = renderWiringSvg(weatherEsp32, board, { overrides: { dht1: { x: 200, y: 8 } } });
    expect(moved.width).toBeGreaterThan(width);
  });
  it('escapes project titles', () => {
    const evil = { ...weatherEsp32, title: '</title><script>alert(1)</script>' };
    const out = renderWiringSvg(evil, board).svg;
    expect(out).not.toContain('<script');
  });
});

describe('renderPinoutSvg', () => {
  const { svg } = renderPinoutSvg(weatherEsp32, board);
  it('marks every used pin with a ring and a label', () => {
    expect(svg).not.toMatch(/NaN|undefined/);
    expect(svg).toContain('dht1:DATA +1');
    expect(svg).toContain('oled1:SDA');
    expect(svg.match(/class="pin-ring"/g)!.length).toBe(7); // GPIO4, 18, 19, 21, 22, 3V3, GND2
  });
});
