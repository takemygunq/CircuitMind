import { describe, expect, it } from 'vitest';
import { weatherEsp32 } from './fixtures';
import { computeNets } from './nets';

describe('computeNets', () => {
  it('merges connections sharing endpoints', () => {
    const { nets, netOfConnection } = computeNets(weatherEsp32);
    const names = nets.map((n) => n.name).sort();
    expect(names).toEqual([
      '3V3',
      'BTN',
      'DHT_DATA',
      'GND',
      'I2C_SCL',
      'I2C_SDA',
      'LED_A',
      'LED_DRV',
    ]);
    expect(netOfConnection).toHaveLength(weatherEsp32.connections.length);
  });

  it('puts the pull-up and the data wire in the same net', () => {
    const { nets, netOfEndpoint } = computeNets(weatherEsp32);
    expect(netOfEndpoint.get('Rpu:2')).toBe(netOfEndpoint.get('dht1:DATA'));
    expect(netOfEndpoint.get('Rpu:2')).toBe(netOfEndpoint.get('board:GPIO4'));
    expect(nets.find((n) => n.name === '3V3')!.endpoints).toEqual([
      'board:3V3',
      'dht1:VCC',
      'oled1:VCC',
      'Rpu:1',
    ]);
  });

  it('names unnamed nets', () => {
    const { nets } = computeNets({ connections: [{ from: 'a:1', to: 'b:1' }] });
    expect(nets[0].name).toBe('NET1');
  });
});
