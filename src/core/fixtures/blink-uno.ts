import { Project } from '../schema';

/** Минимальный эталонный проект: светодиод на D13 через резистор 150 Ом. */
export const blinkUno: Project = Project.parse({
  title: 'Мигающий светодиод',
  description: 'Светодиод мигает с частотой 1 Гц от пина D13 Arduino Uno.',
  boardId: 'arduino-uno',
  parts: [
    { instanceId: 'R1', componentId: 'resistor', value: '150', position: { x: 84, y: 14 } },
    { instanceId: 'led1', componentId: 'led-5mm-red', position: { x: 104, y: 16 } },
  ],
  connections: [
    { from: 'board:D13', to: 'R1:1', netName: 'LED_DRV', color: 'orange', signal: 'gpio' },
    { from: 'R1:2', to: 'led1:anode', netName: 'LED_A', color: 'orange' },
    { from: 'led1:cathode', to: 'board:GND1', netName: 'GND', color: 'black', signal: 'gnd' },
  ],
  power: { source: 'usb', voltage: 5, budgetMa: 500 },
  calculations: [
    {
      id: 'led-resistor',
      title: 'Резистор для светодиода',
      formula: 'R = (Vcc − Vf) / If',
      inputs: { vccV: 5, vfV: 2, ifMa: 20 },
      result: 150,
      unit: 'Ом',
      explanation: 'Резистор гасит разницу между 5 В пина и падением на светодиоде при токе 20 мА.',
    },
  ],
  bom: [
    { componentId: 'led-5mm-red', qty: 1 },
    { componentId: 'resistor', qty: 1, value: '150' },
  ],
  warnings: [],
  codeHints: { libraries: [], pinMap: { LED: 'D13' } },
});
