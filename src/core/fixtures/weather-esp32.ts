import { Project } from '../schema';

/** Тестовый проект Фазы 2: метеостанция на ESP32 (датчик, OLED, светодиод, кнопка). */
export const weatherEsp32: Project = Project.parse({
  title: 'Мини-метеостанция на ESP32',
  description:
    'ESP32 измеряет температуру и влажность датчиком DHT22, показывает значения на OLED-дисплее SSD1306, ' +
    'мигает светодиодом при выходе за порог, а кнопка переключает экран.',
  boardId: 'esp32-devkit-v1',
  parts: [
    { instanceId: 'dht1', componentId: 'dht22', position: { x: 54, y: 8 } },
    { instanceId: 'Rpu', componentId: 'resistor', value: '4.7k', position: { x: 70, y: 36 } },
    { instanceId: 'oled1', componentId: 'ssd1306-128x64-i2c', position: { x: 96, y: 8 } },
    { instanceId: 'led1', componentId: 'led-5mm-red', position: { x: 60, y: 70 } },
    { instanceId: 'R1', componentId: 'resistor', value: '220', position: { x: 74, y: 70 } },
    { instanceId: 'btn1', componentId: 'button-6mm', position: { x: 96, y: 70 } },
  ],
  connections: [
    { from: 'board:3V3', to: 'dht1:VCC', netName: '3V3', color: 'red', signal: 'power' },
    { from: 'board:3V3', to: 'oled1:VCC', netName: '3V3', color: 'red', signal: 'power' },
    { from: 'board:3V3', to: 'Rpu:1', netName: '3V3', color: 'red', signal: 'power' },
    { from: 'board:GPIO4', to: 'dht1:DATA', netName: 'DHT_DATA', color: 'green', signal: 'gpio' },
    { from: 'Rpu:2', to: 'dht1:DATA', netName: 'DHT_DATA', color: 'green' },
    { from: 'board:GPIO21', to: 'oled1:SDA', netName: 'I2C_SDA', color: 'blue', signal: 'i2c_sda' },
    {
      from: 'board:GPIO22',
      to: 'oled1:SCL',
      netName: 'I2C_SCL',
      color: 'yellow',
      signal: 'i2c_scl',
    },
    { from: 'board:GPIO18', to: 'R1:1', netName: 'LED_DRV', color: 'orange', signal: 'gpio' },
    { from: 'R1:2', to: 'led1:anode', netName: 'LED_A', color: 'orange' },
    { from: 'board:GPIO19', to: 'btn1:1', netName: 'BTN', color: 'purple', signal: 'gpio' },
    { from: 'board:GND2', to: 'dht1:GND', netName: 'GND', color: 'black', signal: 'gnd' },
    { from: 'board:GND2', to: 'oled1:GND', netName: 'GND', color: 'black', signal: 'gnd' },
    { from: 'board:GND2', to: 'led1:cathode', netName: 'GND', color: 'black', signal: 'gnd' },
    { from: 'board:GND2', to: 'btn1:2', netName: 'GND', color: 'black', signal: 'gnd' },
  ],
  power: { source: 'usb', voltage: 5, budgetMa: 500 },
  calculations: [
    {
      id: 'led-resistor',
      title: 'Резистор для светодиода',
      formula: 'R = (Vcc − Vf) / If',
      inputs: { vccV: 3.3, vfV: 2, ifMa: 6 },
      result: 217,
      unit: 'Ом',
      explanation:
        'Берём ближайший номинал 220 Ом: ток ≈ 6 мА, ярко и безопасно для пина ESP32 (до 12 мА).',
    },
  ],
  bom: [
    { componentId: 'dht22', qty: 1 },
    { componentId: 'ssd1306-128x64-i2c', qty: 1 },
    { componentId: 'led-5mm-red', qty: 1 },
    { componentId: 'resistor', qty: 1, value: '220' },
    { componentId: 'resistor', qty: 1, value: '4.7k' },
    { componentId: 'button-6mm', qty: 1 },
  ],
  warnings: [
    {
      level: 'info',
      text: 'Кнопка подключена между GPIO19 и GND: включите внутреннюю подтяжку INPUT_PULLUP.',
    },
    { level: 'warning', text: 'DHT22 нельзя опрашивать чаще, чем раз в 2 секунды.' },
  ],
  codeHints: {
    libraries: ['DHT sensor library', 'Adafruit SSD1306'],
    pinMap: { DHT: 'GPIO4', SDA: 'GPIO21', SCL: 'GPIO22', LED: 'GPIO18', BUTTON: 'GPIO19' },
  },
});
