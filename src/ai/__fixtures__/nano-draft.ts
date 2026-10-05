import type { BoardDraft, PinDraft } from '@/core/schema';

type Extra = Partial<Pick<PinDraft, 'voltage' | 'maxCurrentMa' | 'flags' | 'notes'>>;

const pin = (
  id: string,
  label: string,
  functions: PinDraft['functions'],
  electrical: PinDraft['electrical'],
  extra: Extra = {},
): PinDraft => ({
  id,
  label,
  functions,
  electrical,
  voltage: extra.voltage ?? null,
  maxCurrentMa: extra.maxCurrentMa ?? null,
  physicalPin: null,
  flags: extra.flags ?? [],
  notes: extra.notes ?? [],
  gapBefore: 0,
});
const io = (id: string, label: string, fn: PinDraft['functions'] = []) =>
  pin(id, label, ['gpio', ...fn], 'bidirectional', { voltage: 5, maxCurrentMa: 20 });
const gnd = (id: string) => pin(id, 'GND', ['gnd'], 'gnd', { voltage: 0 });
const rst = (id: string) =>
  pin(id, 'RST', ['other'], 'input', { voltage: 5, notes: ['LOW перезапускает МК'] });

/** Эталонный «ответ ИИ» для платы, которой нет во встроенной библиотеке. */
export function makeNanoDraft(): BoardDraft {
  const top = [
    io('D12', 'D12', ['spi_miso']),
    io('D11', '~D11', ['pwm', 'spi_mosi']),
    io('D10', '~D10', ['pwm', 'spi_cs']),
    io('D9', '~D9', ['pwm']),
    io('D8', 'D8'),
    io('D7', 'D7'),
    io('D6', '~D6', ['pwm']),
    io('D5', '~D5', ['pwm']),
    io('D4', 'D4'),
    io('D3', '~D3', ['pwm']),
    io('D2', 'D2'),
    gnd('GND1'),
    rst('RESET1'),
    io('D0', 'RX0', ['uart_rx']),
    io('D1', 'TX1', ['uart_tx']),
  ];
  const bottom = [
    io('D13', 'D13', ['spi_sck']),
    pin('3V3', '3V3', ['power'], 'power_out', { voltage: 3.3, maxCurrentMa: 50 }),
    pin('AREF', 'AREF', ['other'], 'input'),
    ...[0, 1, 2, 3].map((i) => io('A' + i, 'A' + i, ['adc'])),
    io('A4', 'A4', ['adc', 'i2c_sda']),
    io('A5', 'A5', ['adc', 'i2c_scl']),
    pin('A6', 'A6', ['adc'], 'input', { voltage: 5, notes: ['Только аналоговый вход'] }),
    pin('A7', 'A7', ['adc'], 'input', { voltage: 5, notes: ['Только аналоговый вход'] }),
    pin('5V', '5V', ['power'], 'power_out', { voltage: 5, maxCurrentMa: 500 }),
    rst('RESET2'),
    gnd('GND2'),
    pin('VIN', 'VIN', ['power'], 'power_in', { notes: ['Вход 7–12 В'] }),
  ];
  return {
    id: 'arduino-nano',
    name: 'Arduino Nano',
    aliases: ['nano', 'arduino nano', 'arduino nano v3'],
    mcu: 'ATmega328P',
    logicVoltage: 5,
    supplyMinV: 7,
    supplyMaxV: 12,
    supplyPinIds: ['VIN'],
    rails: [
      { pinId: '5V', voltage: 5, maxCurrentMa: 500, note: '' },
      { pinId: '3V3', voltage: 3.3, maxCurrentMa: 50, note: 'От чипа USB-Serial' },
    ],
    maxTotalCurrentMa: 200,
    languages: ['arduino'],
    simulator: 'avr8js',
    widthMm: 43.2,
    heightMm: 18.5,
    headers: [
      { name: 'top', originX: 3.8, originY: 1.7, direction: 'right', pitch: 2.54, pins: top },
      {
        name: 'bottom',
        originX: 3.8,
        originY: 16.8,
        direction: 'right',
        pitch: 2.54,
        pins: bottom,
      },
    ],
    art: {
      pcbColor: '#1d4ed8',
      silkColor: '#f4f4f4',
      pinStyle: 'header',
      parts: [
        { type: 'usb', variant: 'mini', side: 'left', x: 2.2, y: 9.25 },
        { type: 'chip', package: 'qfp', label: 'ATMEGA328', x: 23, y: 9.25, w: 7, h: 7 },
        { type: 'chip', package: 'soic', label: 'FT232', x: 13, y: 9.25, w: 4, h: 5 },
        { type: 'button', label: '', color: '#222222', x: 31.5, y: 9.25 },
        { type: 'led', label: 'L', color: '#f2b84b', x: 36.5, y: 7.2 },
        { type: 'led', label: 'PWR', color: '#3cff6e', x: 36.5, y: 11.3 },
      ],
    },
    notes: [
      'Распиновка Arduino Nano v3.0 (ATmega328P)',
      'USB-Serial чип FT232/CH340 зависит от клона',
    ],
  };
}
