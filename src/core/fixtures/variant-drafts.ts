import { VariantInput } from '../variants';
import { blinkUno, weatherEsp32 } from './index';

const strip = (p: typeof blinkUno) => ({
  parts: p.parts,
  connections: p.connections,
  power: p.power,
  ...(p.codeHints && { codeHints: p.codeHints }),
});

/** Четыре готовых варианта для демо-режима: проверены ERC, разные платы и сложность. */
export const mockVariantInputs: VariantInput[] = [
  VariantInput.parse({
    id: 'blink-uno',
    title: 'Мигающий светодиод на Arduino Uno',
    summary: 'Классический первый проект: светодиод через резистор 150 Ом мигает от пина D13.',
    difficulty: 1,
    buildMinutes: 10,
    boardId: 'arduino-uno',
    draft: strip(blinkUno),
  }),
  VariantInput.parse({
    id: 'dimmer-uno',
    title: 'Плавная регулировка яркости потенциометром',
    summary:
      'Потенциометр на A0 задаёт яркость светодиода на ШИМ-пине D9. Крутите ручку — свет меняется плавно.',
    difficulty: 2,
    buildMinutes: 20,
    boardId: 'arduino-uno',
    draft: {
      parts: [
        { instanceId: 'pot1', componentId: 'potentiometer-10k' },
        { instanceId: 'R1', componentId: 'resistor', value: '150' },
        { instanceId: 'led1', componentId: 'led-5mm-red' },
      ],
      connections: [
        { from: 'board:5V', to: 'pot1:3', netName: '5V', color: 'red', signal: 'power' },
        { from: 'board:GND1', to: 'pot1:1', netName: 'GND', color: 'black', signal: 'gnd' },
        { from: 'pot1:wiper', to: 'board:A0', netName: 'POT', color: 'yellow', signal: 'adc' },
        { from: 'board:D9', to: 'R1:1', netName: 'LED_DRV', color: 'orange', signal: 'pwm' },
        { from: 'R1:2', to: 'led1:anode', netName: 'LED_A', color: 'orange' },
        { from: 'led1:cathode', to: 'board:GND1', netName: 'GND', color: 'black', signal: 'gnd' },
      ],
      power: { source: 'usb', voltage: 5, budgetMa: 500 },
      codeHints: { libraries: [], pinMap: { POT: 'A0', LED: 'D9' } },
    },
  }),
  VariantInput.parse({
    id: 'pico-pot-led',
    title: 'Регулятор света на Raspberry Pi Pico',
    summary:
      'Потенциометр на АЦП GP26 управляет яркостью светодиода на GP15 (ШИМ). Код на MicroPython.',
    difficulty: 2,
    buildMinutes: 25,
    boardId: 'raspberry-pi-pico',
    draft: {
      parts: [
        { instanceId: 'pot1', componentId: 'potentiometer-10k' },
        { instanceId: 'R1', componentId: 'resistor', value: '220' },
        { instanceId: 'led1', componentId: 'led-5mm-red' },
      ],
      connections: [
        { from: 'board:3V3', to: 'pot1:3', netName: '3V3', color: 'red', signal: 'power' },
        { from: 'board:GND1', to: 'pot1:1', netName: 'GND', color: 'black', signal: 'gnd' },
        { from: 'pot1:wiper', to: 'board:GP26', netName: 'POT', color: 'yellow', signal: 'adc' },
        { from: 'board:GP15', to: 'R1:1', netName: 'LED_DRV', color: 'orange', signal: 'pwm' },
        { from: 'R1:2', to: 'led1:anode', netName: 'LED_A', color: 'orange' },
        { from: 'led1:cathode', to: 'board:GND1', netName: 'GND', color: 'black', signal: 'gnd' },
      ],
      power: { source: 'usb', voltage: 5, budgetMa: 500 },
      codeHints: { libraries: [], pinMap: { POT: 'GP26', LED: 'GP15' } },
    },
  }),
  VariantInput.parse({
    id: 'weather-esp32',
    title: 'Мини-метеостанция на ESP32',
    summary:
      'Датчик DHT22 и OLED-дисплей показывают температуру и влажность, светодиод сигналит о выходе за порог.',
    difficulty: 3,
    buildMinutes: 60,
    boardId: 'esp32-devkit-v1',
    draft: strip(weatherEsp32),
  }),
];
