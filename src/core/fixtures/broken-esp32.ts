import { Project } from '../schema';

/** Намеренно неисправный проект: показывает, как ERC находит типичные ошибки новичков. */
export const brokenEsp32: Project = Project.parse({
  title: 'Дальномер с ошибками (учебный пример ERC)',
  description:
    'ESP32, дальномер HC-SR04 и светодиод. В схеме нарочно допущено несколько типичных ошибок.',
  boardId: 'esp32-devkit-v1',
  parts: [
    { instanceId: 'hc1', componentId: 'hc-sr04', position: { x: 64, y: 6 } },
    { instanceId: 'led1', componentId: 'led-5mm-red', position: { x: 76, y: 44 } },
    { instanceId: 'm1', componentId: 'dc-motor-130', position: { x: 100, y: 40 } },
  ],
  connections: [
    { from: 'board:3V3', to: 'hc1:VCC', netName: '3V3', signal: 'power' },
    { from: 'board:GND2', to: 'hc1:GND', netName: 'GND', signal: 'gnd' },
    { from: 'board:GPIO18', to: 'hc1:TRIG', netName: 'TRIG' },
    { from: 'board:GPIO19', to: 'hc1:ECHO', netName: 'ECHO' },
    { from: 'board:GPIO5', to: 'led1:anode', netName: 'LED' },
    { from: 'led1:cathode', to: 'board:GND2', netName: 'GND', signal: 'gnd' },
    { from: 'board:GPIO23', to: 'm1:M+', netName: 'MOTOR' },
    { from: 'm1:M-', to: 'board:GND2', netName: 'GND', signal: 'gnd' },
  ],
  power: { source: 'usb', voltage: 5, budgetMa: 500 },
  calculations: [],
  bom: [],
  warnings: [],
});
