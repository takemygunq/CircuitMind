import { describe, expect, it } from 'vitest';
import { demoProjects } from '../fixtures';
import { Project, parseEndpoint } from '../schema';
import {
  boards,
  components,
  getBoard,
  getComponent,
  searchComponents,
  validateProjectRefs,
} from './index';

describe('library', () => {
  it('has the MVP boards and components', () => {
    expect(boards.map((b) => b.id).sort()).toEqual([
      'arduino-uno',
      'esp32-devkit-v1',
      'raspberry-pi-pico',
    ]);
    expect(components).toHaveLength(15);
  });

  it('has unique ids', () => {
    for (const list of [boards, components]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('matches real pin counts', () => {
    expect(getBoard('arduino-uno')!.pins).toHaveLength(29);
    expect(getBoard('esp32-devkit-v1')!.pins).toHaveLength(30);
    expect(getBoard('raspberry-pi-pico')!.pins).toHaveLength(40);
  });

  it('flags ESP32 special pins', () => {
    const esp = getBoard('esp32-devkit-v1')!;
    const pin = (id: string) => esp.pins.find((p) => p.id === id)!;
    expect(pin('GPIO34').flags).toContain('input_only');
    expect(pin('GPIO12').flags).toContain('strapping');
    expect(pin('GPIO25').flags).toContain('adc2');
    expect(pin('GPIO25').functions).toContain('dac');
    expect(pin('GPIO21').functions).toContain('i2c_sda');
    expect(esp.logicVoltage).toBe(3.3);
  });

  it('maps Pico peripherals', () => {
    const pico = getBoard('raspberry-pi-pico')!;
    const gp4 = pico.pins.find((p) => p.id === 'GP4')!;
    expect(gp4.functions).toEqual(expect.arrayContaining(['i2c_sda', 'spi_miso', 'uart_tx']));
    expect(pico.pins.find((p) => p.id === 'GP26')!.functions).toContain('adc');
    expect(pico.pins.filter((p) => p.functions.includes('gnd'))).toHaveLength(8);
  });

  it('keeps Uno 5 V and 20 mA per pin', () => {
    const uno = getBoard('arduino-uno')!;
    expect(uno.logicVoltage).toBe(5);
    expect(uno.pins.find((p) => p.id === 'D13')!.maxCurrentMa).toBe(20);
    expect(uno.pins.find((p) => p.id === 'D3')!.functions).toContain('pwm');
    expect(uno.pins.find((p) => p.id === 'D4')!.functions).not.toContain('pwm');
  });

  it('marks HC-SR04 ECHO as a 5 V output', () => {
    const echo = getComponent('hc-sr04')!.pins.find((p) => p.id === 'ECHO')!;
    expect(echo.voltage).toBe(5);
    expect(echo.electrical).toBe('output');
  });

  it('searches components', () => {
    expect(searchComponents('irlz44n').map((c) => c.id)).toEqual(['mosfet-irlz44n']);
    expect(
      searchComponents('', 'sensor')
        .map((c) => c.id)
        .sort(),
    ).toEqual(['dht22', 'hc-sr04']);
  });
});

describe('schema', () => {
  it('parses endpoints', () => {
    expect(parseEndpoint('board:GPIO21')).toEqual({ ref: 'board', pin: 'GPIO21' });
  });

  it.each(demoProjects.map((d) => [d.id, d.project] as const))(
    'demo project %s resolves all references',
    (_id, project) => {
      expect(validateProjectRefs(project)).toEqual([]);
    },
  );

  it('rejects connections to unknown parts', () => {
    const bad = { ...demoProjects[1].project, connections: [{ from: 'board:D13', to: 'X9:1' }] };
    expect(Project.safeParse(bad).success).toBe(false);
  });

  it('rejects duplicate and reserved instance ids', () => {
    expect(
      Project.safeParse({
        ...demoProjects[1].project,
        parts: [demoProjects[1].project.parts[0], demoProjects[1].project.parts[0]],
      }).success,
    ).toBe(false);
    expect(
      Project.safeParse({
        ...demoProjects[1].project,
        parts: [{ ...demoProjects[1].project.parts[0], instanceId: 'board' }],
      }).success,
    ).toBe(false);
  });

  it('rejects malformed endpoints', () => {
    const bad = { ...demoProjects[1].project, connections: [{ from: 'D13', to: 'R1:1' }] };
    expect(Project.safeParse(bad).success).toBe(false);
  });

  it('reports unknown boards, components and pins', () => {
    const bad: Project = {
      ...demoProjects[1].project,
      boardId: 'nope',
      parts: [{ instanceId: 'R1', componentId: 'ghost' }, demoProjects[1].project.parts[1]],
      connections: [{ from: 'led1:plus', to: 'R1:1' }],
    };
    const paths = validateProjectRefs(bad).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(['boardId', 'parts[0].componentId', 'connections[0].from']),
    );
  });
});
