'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AVR_PINS, AvrMachine, CLOCK_HZ, type AvrPin } from '@/core/emu/avr';
import type { BoardDef } from '@/core/schema';
import type { GpioMode } from '@/core/sim';
import { useWorkspace } from '@/store/workspace';
import { useSim } from './useSim';

export type EmulatorStatus = 'stopped' | 'running' | 'error';

export interface EmulatorApi {
  /** Плата поддерживается эмулятором (ATmega328P). */
  eligible: boolean;
  status: EmulatorStatus;
  error: string | null;
  elapsedMs: number;
  speed: number;
  setSpeed: (n: number) => void;
  serial: string;
  clearSerial: () => void;
  sendSerial: (text: string) => void;
  start: (hex: string) => void;
  stop: () => void;
  /** Пины платы, которыми сейчас управляет прошивка. */
  controlled: ReadonlySet<string>;
}

const Ctx = createContext<EmulatorApi | null>(null);
export const useEmulator = (): EmulatorApi => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEmulator must be used inside EmulatorProvider');
  return v;
};

const MAX_SERIAL = 4000;
const PWM_TOGGLES = 4; // за кадр (~16 мс) столько переключений — это уже ШИМ, а не обычный вывод
const HIGH_THRESHOLD_V = 2.5;

/**
 * Запускает эмулятор прошивки и замыкает его на электрическую симуляцию:
 * состояния выходов МК → режимы пинов DC-модели; напряжения на входных пинах (кнопки, делители) и аналоговые уровни → обратно в МК.
 */
export function EmulatorProvider({
  board,
  children,
}: {
  board: BoardDef | undefined;
  children: ReactNode;
}) {
  const projectId = useWorkspace((s) => s.projectId);
  const applyEmulator = useWorkspace((s) => s.applyEmulator);
  const sim = useSim(board);
  const simRef = useRef(sim);
  useEffect(() => {
    simRef.current = sim;
  }, [sim]);

  const eligible = board?.simulator === 'avr8js';
  const [status, setStatus] = useState<EmulatorStatus>('stopped');
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [serial, setSerial] = useState('');
  const [speed, setSpeed] = useState(1);
  const [controlled, setControlled] = useState<ReadonlySet<string>>(new Set());
  const machine = useRef<AvrMachine | null>(null);
  const raf = useRef<number | null>(null);
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  const lastApplied = useRef('');

  const halt = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    machine.current = null;
    lastApplied.current = '';
    setControlled(new Set());
  }, []);

  const stop = useCallback(() => {
    halt();
    setStatus('stopped');
    // отпускаем пины: прошивка больше не управляет ими
    const gpio = Object.fromEntries(
      Object.keys(useWorkspace.getState().simGpio).map((p) => [p, 'hiz' as GpioMode]),
    );
    applyEmulator(gpio, {});
  }, [halt, applyEmulator]);

  const start = useCallback(
    (hex: string) => {
      halt();
      setError(null);
      setSerial('');
      setElapsedMs(0);
      let m: AvrMachine;
      try {
        m = new AvrMachine(hex);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
        return;
      }
      machine.current = m;
      let pending = '';
      let lastFlush = 0;
      m.onSerial((t) => {
        pending += t;
      });
      setStatus('running');

      let last = performance.now();
      const frame = (now: number) => {
        const dt = Math.min(100, now - last);
        last = now;
        const cur = machine.current;
        if (!cur) return;
        const result = simRef.current?.result;
        const known = new Set(Object.keys(simRef.current?.state.gpio ?? {}));

        // электрическая схема → МК
        for (const pin of AVR_PINS) {
          const v = result?.board[pin]?.v;
          if (v === undefined) continue;
          if (pin[0] === 'A') cur.setAnalog(pin, v);
          const st = cur.pinState(pin);
          if (st === 'input' || st === 'pullup') cur.setInput(pin, v >= HIGH_THRESHOLD_V);
        }

        cur.resetWindow();
        cur.run((CLOCK_HZ / 1000) * dt * speedRef.current);

        // МК → электрическая схема
        const gpio: Record<string, GpioMode> = {};
        const duty: Record<string, number> = {};
        const owned = new Set<string>();
        for (const pin of AVR_PINS as readonly AvrPin[]) {
          if (!known.has(pin)) continue;
          owned.add(pin);
          const w = cur.window(pin);
          const st = cur.pinState(pin);
          if ((st === 'high' || st === 'low') && w.toggles >= PWM_TOGGLES) {
            gpio[pin] = 'pwm';
            duty[pin] = Math.round(w.duty * 100) / 100;
          } else
            gpio[pin] =
              st === 'high' ? 'high' : st === 'low' ? 'low' : st === 'pullup' ? 'pullup' : 'hiz';
        }
        const signature = JSON.stringify([gpio, duty]);
        if (signature !== lastApplied.current) {
          lastApplied.current = signature;
          applyEmulator(gpio, duty);
          setControlled(owned);
        }

        if (now - lastFlush > 100) {
          lastFlush = now;
          setElapsedMs(cur.millis);
          if (pending) {
            const chunk = pending;
            pending = '';
            setSerial((s) => (s + chunk).slice(-MAX_SERIAL));
          }
        }
        raf.current = requestAnimationFrame(frame);
      };
      raf.current = requestAnimationFrame(frame);
    },
    [halt, applyEmulator],
  );

  // смена проекта или платы останавливает прошивку; при размонтировании освобождаем цикл
  useEffect(() => () => halt(), [halt]);
  const prevProject = useRef(projectId);
  useEffect(() => {
    if (prevProject.current !== projectId) {
      prevProject.current = projectId;
      if (machine.current) stop();
    }
  }, [projectId, stop]);

  const api = useMemo<EmulatorApi>(
    () => ({
      eligible,
      status,
      error,
      elapsedMs,
      speed,
      setSpeed,
      serial,
      clearSerial: () => setSerial(''),
      sendSerial: (text) => machine.current?.serialWrite(text),
      start,
      stop,
      controlled,
    }),
    [eligible, status, error, elapsedMs, speed, serial, start, stop, controlled],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
