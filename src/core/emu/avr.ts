import {
  AVRADC,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  PinState,
  adcConfig,
  avrInstruction,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
} from 'avr8js';
import { parseIntelHex } from './hex';

export const CLOCK_HZ = 16_000_000;
const FLASH_BYTES = 32768;

export const AVR_PINS = [
  'D0',
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'D7',
  'D8',
  'D9',
  'D10',
  'D11',
  'D12',
  'D13',
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
] as const;
export type AvrPin = (typeof AVR_PINS)[number];
export type AvrPinState = 'low' | 'high' | 'input' | 'pullup';

type PortId = 'B' | 'C' | 'D';
/** Uno/Nano: D0–D7 → PORTD, D8–D13 → PORTB, A0–A5 → PORTC. */
const LOCATION: Record<AvrPin, { port: PortId; bit: number }> = Object.fromEntries(
  AVR_PINS.map((p) => {
    const n = Number(p.slice(1));
    if (p[0] === 'A') return [p, { port: 'C', bit: n }];
    return [p, n < 8 ? { port: 'D', bit: n } : { port: 'B', bit: n - 8 }];
  }),
) as never;

interface Track {
  lastChange: number;
  lastHigh: boolean;
  highCycles: number;
  toggles: number;
}

export interface PinWindow {
  /** Доля времени на высоком уровне с начала окна (для выходов). */
  duty: number;
  /** Сколько раз пин менял уровень в окне — по нему отличаем ШИМ от обычного вывода. */
  toggles: number;
}

/** Эмулятор ATmega328P (Arduino Uno/Nano) на avr8js: таймеры, GPIO, USART, АЦП. */
export class AvrMachine {
  readonly cpu: CPU;
  private readonly ports: Record<PortId, AVRIOPort>;
  private readonly usart: AVRUSART;
  private readonly adc: AVRADC;
  private readonly tracks = new Map<AvrPin, Track>();
  private windowStart = 0;
  private serialListener: ((text: string) => void) | null = null;
  /** Очередь приёма: USART принимает по одному байту за время передачи символа. */
  private rxQueue: number[] = [];

  constructor(hex: string) {
    const flash = parseIntelHex(hex, FLASH_BYTES);
    const words = new Uint16Array(FLASH_BYTES / 2);
    for (let i = 0; i < words.length; i++) words[i] = flash[i * 2] | (flash[i * 2 + 1] << 8);
    this.cpu = new CPU(words);
    new AVRTimer(this.cpu, timer0Config);
    new AVRTimer(this.cpu, timer1Config);
    new AVRTimer(this.cpu, timer2Config);
    this.ports = {
      B: new AVRIOPort(this.cpu, portBConfig),
      C: new AVRIOPort(this.cpu, portCConfig),
      D: new AVRIOPort(this.cpu, portDConfig),
    };
    this.usart = new AVRUSART(this.cpu, usart0Config, CLOCK_HZ);
    this.adc = new AVRADC(this.cpu, adcConfig);
    this.usart.onByteTransmit = (b) => this.serialListener?.(String.fromCharCode(b));
    this.usart.onRxComplete = () => this.feedRx();

    for (const pin of AVR_PINS)
      this.tracks.set(pin, { lastChange: 0, lastHigh: false, highCycles: 0, toggles: 0 });
    for (const id of ['B', 'C', 'D'] as const)
      this.ports[id].addListener(() => {
        for (const pin of AVR_PINS) {
          const loc = LOCATION[pin];
          if (loc.port !== id) continue;
          const t = this.tracks.get(pin)!;
          const high = this.ports[id].pinState(loc.bit) === PinState.High;
          if (high === t.lastHigh) continue;
          if (t.lastHigh)
            t.highCycles += this.cpu.cycles - Math.max(t.lastChange, this.windowStart);
          t.lastChange = this.cpu.cycles;
          t.lastHigh = high;
          t.toggles++;
        }
      });
  }

  get cycles(): number {
    return this.cpu.cycles;
  }

  /** Время работы программы, мс. */
  get millis(): number {
    return (this.cpu.cycles / CLOCK_HZ) * 1000;
  }

  /** Выполняет программу ещё `cycles` тактов (16 000 тактов = 1 мс). */
  run(cycles: number): void {
    const end = this.cpu.cycles + cycles;
    while (this.cpu.cycles < end) {
      avrInstruction(this.cpu);
      this.cpu.tick();
    }
  }

  pinState(pin: AvrPin): AvrPinState {
    const { port, bit } = LOCATION[pin];
    return (['low', 'high', 'input', 'pullup'] as const)[this.ports[port].pinState(bit)];
  }

  /** Внешний сигнал на входе (то, что программа прочитает через digitalRead). */
  setInput(pin: AvrPin, high: boolean): void {
    const { port, bit } = LOCATION[pin];
    this.ports[port].setPin(bit, high);
  }

  /** Напряжение на аналоговом входе 0..5 В для analogRead. */
  setAnalog(pin: AvrPin, volts: number): void {
    if (pin[0] === 'A')
      this.adc.channelValues[Number(pin.slice(1))] = Math.min(5, Math.max(0, volts));
  }

  onSerial(listener: ((text: string) => void) | null): void {
    this.serialListener = listener;
  }

  /** Передаёт байты в UART программы (как будто пользователь печатает в мониторе порта). */
  serialWrite(text: string): void {
    for (const ch of text) this.rxQueue.push(ch.charCodeAt(0) & 0xff);
    this.feedRx();
  }

  private feedRx(): void {
    if (!this.rxQueue.length || this.usart.rxBusy) return;
    if (this.usart.writeByte(this.rxQueue[0])) this.rxQueue.shift();
  }

  get baudRate(): number {
    return this.usart.baudRate;
  }

  /** Статистика пина за окно с последнего `resetWindow()`. */
  window(pin: AvrPin): PinWindow {
    const t = this.tracks.get(pin)!;
    const span = Math.max(1, this.cpu.cycles - this.windowStart);
    const high =
      t.highCycles + (t.lastHigh ? this.cpu.cycles - Math.max(t.lastChange, this.windowStart) : 0);
    return { duty: Math.min(1, high / span), toggles: t.toggles };
  }

  resetWindow(): void {
    this.windowStart = this.cpu.cycles;
    for (const t of this.tracks.values()) {
      t.highCycles = 0;
      t.toggles = 0;
      t.lastChange = this.cpu.cycles;
    }
  }
}
