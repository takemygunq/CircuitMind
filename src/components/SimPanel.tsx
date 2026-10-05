'use client';

import { formatCurrent, formatVoltage, type GpioMode } from '@/core/sim';
import type { MessageKey } from '@/i18n';
import { useWorkspace } from '@/store/workspace';
import { useEmulator } from './EmulatorProvider';
import { FirmwarePanel } from './FirmwarePanel';
import type { SimBundle } from './useSim';
import { PartCards } from './PartCards';
import { useT } from './useT';

const MODES: GpioMode[] = ['hiz', 'low', 'high', 'pullup'];

export function SimPanel({
  sim,
  showValues,
  onShowValues,
}: {
  sim: SimBundle;
  showValues: boolean;
  onShowValues: (v: boolean) => void;
}) {
  const t = useT();
  const project = useWorkspace((s) => s.project);
  const setGpio = useWorkspace((s) => s.setSimGpio);
  const setPressed = useWorkspace((s) => s.setSimPressed);
  const setPot = useWorkspace((s) => s.setSimPot);
  const reset = useWorkspace((s) => s.resetSim);
  const emu = useEmulator();
  const { board, state, result } = sim;

  const pinOrder = board.pins.map((p) => p.id).filter((id) => id in state.gpio);
  const buttons = project.parts.filter((p) => p.componentId === 'button-6mm');
  const pots = project.parts.filter((p) => p.componentId === 'potentiometer-10k');
  const failed = Object.entries(result.failed);

  return (
    <aside className="border-line bg-panel flex max-h-full flex-col overflow-hidden border-t lg:w-[26rem] lg:shrink-0 lg:border-t-0 lg:border-l">
      <div className="border-line flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-sm font-semibold">{t('sim.controls')}</h2>
        <button
          type="button"
          onClick={reset}
          className="text-muted hover:bg-canvas focus-visible:outline-accent rounded px-2 py-0.5 text-xs focus-visible:outline-2"
        >
          {t('sim.reset')}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <p role="note" className="bg-info-bg text-info-fg rounded-md px-3 py-2 text-xs">
          {t('sim.disclaimer')}
        </p>

        <FirmwarePanel />

        {result.warnings.length > 0 && (
          <ul className="flex flex-col gap-1">
            {result.warnings.map((w, i) => (
              <li key={i} className="bg-warn-bg text-warn-fg rounded-md px-2 py-1 text-xs">
                ⚠{' '}
                {t(`sim.warn.${w.code}` as MessageKey, {
                  ref: w.ref,
                  value: Math.round(w.value * 10) / 10,
                  limit: w.limit ?? 0,
                })}
              </li>
            ))}
          </ul>
        )}

        <section aria-labelledby="sim-failed">
          <h3 id="sim-failed" className="text-muted mb-1 text-xs font-medium">
            {t('sim.failed')}
          </h3>
          {failed.length === 0 ? (
            <p className="text-sm">{t('sim.noFailures')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {failed.map(([id, reason]) => (
                <li key={id} className="bg-danger-bg text-danger-fg rounded-md px-2 py-1 text-xs">
                  ✕ <span className="font-mono font-semibold">{id}</span> —{' '}
                  {t(`sim.reason.${reason}` as MessageKey)}
                </li>
              ))}
            </ul>
          )}
        </section>

        {pinOrder.length > 0 && (
          <section aria-labelledby="sim-pins">
            <h3 id="sim-pins" className="text-muted mb-1 text-xs font-medium">
              {t('sim.pins')}
            </h3>
            <ul className="flex flex-col gap-2">
              {pinOrder.map((pin) => {
                const st = result.board[pin];
                return (
                  <li key={pin} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-mono font-semibold">
                        {pin}
                        {emu.controlled.has(pin) && (
                          <span className="bg-info-bg text-info-fg ml-2 rounded px-1.5 py-0.5 font-sans text-[10px]">
                            {t('sim.fw.controlled')}
                          </span>
                        )}
                        {state.gpio[pin] === 'pwm' && (
                          <span className="bg-warn-bg text-warn-fg ml-1 rounded px-1.5 py-0.5 font-sans text-[10px]">
                            {t('sim.fw.pwm')} {Math.round((state.duty?.[pin] ?? 0) * 100)}%
                          </span>
                        )}
                      </span>
                      {st && (
                        <span className="text-muted tabular-nums">
                          {formatVoltage(st.v)} · {formatCurrent(Math.abs(st.i))}
                        </span>
                      )}
                    </div>
                    <div
                      role="group"
                      aria-label={pin}
                      className="border-line grid grid-cols-4 overflow-hidden rounded-md border text-xs"
                    >
                      {MODES.map((m) => (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={state.gpio[pin] === m}
                          disabled={emu.controlled.has(pin)}
                          title={
                            m === 'hiz'
                              ? t('sim.mode.hizTitle')
                              : m === 'pullup'
                                ? t('sim.mode.pullupTitle')
                                : undefined
                          }
                          onClick={() => setGpio(pin, m)}
                          className={`focus-visible:outline-accent px-1 py-1.5 focus-visible:outline-2 disabled:cursor-not-allowed ${state.gpio[pin] === m ? 'bg-accent font-semibold text-white' : 'hover:bg-canvas'} ${emu.controlled.has(pin) ? 'opacity-60' : ''}`}
                        >
                          {t(`sim.mode.${m}` as MessageKey)}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {buttons.length > 0 && (
          <section aria-labelledby="sim-buttons">
            <h3 id="sim-buttons" className="text-muted mb-1 text-xs font-medium">
              {t('sim.buttons')}
            </h3>
            <ul className="flex flex-col gap-1">
              {buttons.map((b) => (
                <li key={b.instanceId}>
                  <button
                    type="button"
                    aria-pressed={!!state.pressed[b.instanceId]}
                    onClick={() => setPressed(b.instanceId, !state.pressed[b.instanceId])}
                    className={`focus-visible:outline-accent flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-sm focus-visible:outline-2 ${state.pressed[b.instanceId] ? 'border-accent bg-accent/10 font-semibold' : 'border-line hover:bg-canvas'}`}
                  >
                    <span className="font-mono">{b.instanceId}</span>
                    <span>
                      {state.pressed[b.instanceId] ? t('sim.pressed') : t('sim.released')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {pots.length > 0 && (
          <section aria-labelledby="sim-pots">
            <h3 id="sim-pots" className="text-muted mb-1 text-xs font-medium">
              {t('sim.pots')}
            </h3>
            <ul className="flex flex-col gap-2">
              {pots.map((p) => {
                const wiper = result.parts[p.instanceId]?.pins.wiper;
                return (
                  <li key={p.instanceId} className="flex flex-col gap-1">
                    <label
                      className="flex items-baseline justify-between text-xs"
                      htmlFor={`pot-${p.instanceId}`}
                    >
                      <span className="font-mono font-semibold">{p.instanceId}</span>
                      <span className="text-muted tabular-nums">
                        {t('sim.wiper')}: {wiper ? formatVoltage(wiper.v) : '—'}
                      </span>
                    </label>
                    <input
                      id={`pot-${p.instanceId}`}
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={state.pots[p.instanceId] ?? 0.5}
                      onChange={(e) => setPot(p.instanceId, Number(e.target.value))}
                      className="accent-accent w-full"
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showValues}
            onChange={(e) => onShowValues(e.target.checked)}
            className="accent-accent h-4 w-4"
          />
          {t('sim.values')}
        </label>

        <PartCards board={board} />
      </div>
    </aside>
  );
}
