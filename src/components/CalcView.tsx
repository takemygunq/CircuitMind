'use client';

import { useMemo, useState } from 'react';
import {
  CALC_FIELDS,
  CALC_TYPES,
  CalcError,
  calcTypeFromId,
  calculate,
  checkCalculation,
  defaultInputs,
  unitFor,
  type CalcResult,
  type CalcType,
} from '@/core/calc';
import { analyzeCircuit } from '@/core/erc';
import { formatOhms } from '@/core/units';
import type { BoardDef, Calculation } from '@/core/schema';
import type { MessageKey } from '@/i18n';
import { useWorkspace } from '@/store/workspace';
import { useT } from './useT';

const STATUS_STYLE = {
  ok: 'bg-info-bg text-info-fg',
  warn: 'bg-warn-bg text-warn-fg',
  fail: 'bg-danger-bg text-danger-fg',
} as const;
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function safeCalculate(
  type: CalcType,
  inputs: Record<string, number>,
): { res: CalcResult } | { error: string } {
  try {
    return { res: calculate(type, inputs) };
  } catch (e) {
    return { error: e instanceof CalcError ? (e.issues[0] ?? e.message) : String(e) };
  }
}

/** Значение результата с единицами: резисторы — в Ω/kΩ/MΩ. */
function formatResult(res: Pick<CalcResult, 'result' | 'unit'>): string {
  return res.unit === 'Ω' ? formatOhms(res.result) : `${round(res.result)} ${res.unit}`;
}

function unitOfExtra(key: string): string {
  if (/Ohm$/.test(key)) return 'Ω';
  if (/Ma$/.test(key)) return 'mA';
  if (/Mw$/.test(key)) return 'mW';
  if (/OutV$|V$/.test(key)) return 'V';
  if (/W$/.test(key)) return 'W';
  if (/Pf$/.test(key)) return 'pF';
  return '';
}

function Extras({ res }: { res: CalcResult }) {
  const rows = Object.entries(res.extra);
  if (!rows.length) return null;
  return (
    <dl className="text-muted grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono">{k}</dt>
          <dd className="text-fg tabular-nums">
            {typeof v === 'number'
              ? unitOfExtra(k) === 'Ω'
                ? formatOhms(v)
                : round(v, 3)
              : String(v)}{' '}
            {typeof v === 'number' && unitOfExtra(k) !== 'Ω' ? unitOfExtra(k) : ''}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function NumberField({
  label,
  unit,
  value,
  optional,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  optional?: boolean;
  onChange: (v: string) => void;
}) {
  const t = useT();
  return (
    <label className="flex flex-col gap-0.5 text-xs">
      <span className="text-muted font-mono">
        {label}
        {unit && <span className="ml-1 font-sans">({unit})</span>}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        placeholder={optional ? t('calc.optional') : ''}
        onChange={(e) => onChange(e.target.value)}
        className="border-line bg-canvas text-fg focus-visible:outline-accent w-28 rounded-md border px-2 py-1 text-sm tabular-nums focus-visible:outline-2"
      />
    </label>
  );
}

export function CalcCard({ calc, projectId }: { calc: Calculation; projectId: string }) {
  const t = useT();
  const key = `${projectId}:${calc.id}`;
  const edited = useWorkspace((s) => s.calcInputs[key]);
  const setCalcInputs = useWorkspace((s) => s.setCalcInputs);
  const type = calcTypeFromId(calc.id);
  const inputs = edited ?? calc.inputs;
  const out = type ? safeCalculate(type, inputs) : undefined;
  const check = !edited && type ? checkCalculation(calc) : undefined;

  const set = (k: string, raw: string) => {
    const next = { ...inputs };
    const v = Number.parseFloat(raw);
    if (raw === '' || !Number.isFinite(v)) delete next[k];
    else next[k] = v;
    setCalcInputs(key, next);
  };

  return (
    <article className="border-line bg-panel flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{calc.title}</h3>
          <p className="text-muted font-mono text-xs">{calc.formula}</p>
        </div>
        {edited && (
          <button
            type="button"
            onClick={() => setCalcInputs(key, null)}
            className="text-accent text-xs underline"
          >
            {t('calc.reset')}
          </button>
        )}
      </header>

      <div className="flex flex-wrap gap-3">
        {Object.entries(inputs).map(([k, v]) => (
          <NumberField
            key={k}
            label={k}
            unit={type ? unitFor(type, k) : ''}
            value={String(v)}
            onChange={(raw) => set(k, raw)}
          />
        ))}
      </div>

      {out && 'res' in out ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-2xl font-semibold tabular-nums">{formatResult(out.res)}</span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[out.res.status]}`}
          >
            {t(`calc.status.${out.res.status}` as MessageKey)}
          </span>
          {edited && (
            <span className="bg-info-bg text-info-fg rounded-full px-2.5 py-0.5 text-xs">
              {t('calc.edited')}
            </span>
          )}
        </div>
      ) : out ? (
        <p role="alert" className="bg-danger-bg text-danger-fg rounded-md px-3 py-2 text-xs">
          {t('calc.error')}: {out.error}
        </p>
      ) : (
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">
            {round(calc.result)} {calc.unit}
          </span>
          <span className="text-muted block text-xs">{t('calc.static')}</span>
        </p>
      )}

      {out && 'res' in out && <Extras res={out.res} />}
      <p className={`text-sm leading-relaxed ${edited ? 'opacity-50' : ''}`}>{calc.explanation}</p>
      {check && check.status !== 'unknown' && (
        <p className={`text-xs ${check.status === 'match' ? 'text-muted' : 'text-warn-fg'}`}>
          {check.status === 'match' ? '✓' : '⚠'}{' '}
          {t('calc.aiValue', { v: `${round(calc.result)} ${calc.unit}` })} —{' '}
          {check.status === 'match' ? t('calc.matches') : t('calc.differs')}
        </p>
      )}
    </article>
  );
}

export function CircuitAnalysis({ board }: { board: BoardDef }) {
  const t = useT();
  const project = useWorkspace((s) => s.project);
  const a = useMemo(() => analyzeCircuit(project, { board }), [project, board]);
  if (!a) return null;
  const { power } = a;
  const over = power.totalMa > power.budgetMa;
  const row = (label: string, value: string, strong = false, warn = false) => (
    <div
      key={label}
      className={`flex justify-between gap-4 py-1 ${strong ? 'border-line border-t font-semibold' : ''} ${warn ? 'text-danger' : ''}`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
  return (
    <section aria-labelledby="circuit-title" className="flex flex-col gap-3">
      <h2 id="circuit-title" className="text-muted text-sm font-semibold">
        {t('calc.circuit')}
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">
        <article className="border-line bg-panel rounded-lg border p-4">
          <h3 className="mb-2 font-semibold">{t('calc.power')}</h3>
          <dl className="text-sm">
            {row(t('calc.selfCurrent'), `${round(power.selfMa)} mA`)}
            {row(t('calc.gpioCurrent'), `${round(power.gpioTotalMa)} mA`)}
            {power.rails.map((r) =>
              row(
                t('calc.rail', { pin: r.pin, v: r.voltage }),
                `${round(r.ma)} mA / ${r.limitMa}`,
                false,
                r.ma > r.limitMa,
              ),
            )}
            {row(t('calc.total'), `${round(power.totalMa)} mA`, true, over)}
            {row(t('calc.budget'), `${power.budgetMa} mA`)}
          </dl>
          {power.rails
            .flatMap((r) => r.peaks)
            .map((p) => (
              <p key={p.part} className="text-warn-fg mt-2 text-xs">
                ⚠ {t('calc.peak', { part: p.part, ma: p.ma })}
              </p>
            ))}
        </article>
        <article className="border-line bg-panel rounded-lg border p-4">
          <h3 className="mb-2 font-semibold">{t('calc.leds')}</h3>
          {a.leds.length === 0 ? (
            <p className="text-muted text-sm">—</p>
          ) : (
            <dl className="text-sm">
              {a.leds.map((l) =>
                row(
                  l.part,
                  l.hasResistor
                    ? l.ma === undefined
                      ? '?'
                      : `${round(l.ma)} mA${l.limitMa ? ` (${t('calc.ledLimit', { limit: l.limitMa })})` : ''}`
                    : t('calc.noResistor'),
                  false,
                  !l.hasResistor ||
                    (l.ma !== undefined && l.limitMa !== undefined && l.ma > l.limitMa),
                ),
              )}
            </dl>
          )}
          <h3 className="mt-4 mb-2 font-semibold">{t('calc.pinsHeader')}</h3>
          <dl className="text-sm">
            {power.gpio.map((p) =>
              row(
                p.pin,
                `${round(p.estMa)} mA${p.limitMa ? ` / ${p.limitMa}` : ''}`,
                false,
                p.limitMa !== undefined && p.estMa > p.limitMa,
              ),
            )}
          </dl>
        </article>
      </div>
    </section>
  );
}

/** Произвольный расчёт: выбираем тип, вводим числа — результат мгновенно. */
export function Playground() {
  const t = useT();
  const [type, setType] = useState<CalcType>('led_resistor');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(defaultInputs('led_resistor')).map(([k, v]) => [k, String(v)]),
    ),
  );
  const fields = type === 'current_budget' ? CALC_FIELDS.current_budget : CALC_FIELDS[type];

  const inputs = Object.fromEntries(
    Object.entries(values).flatMap(([k, raw]) =>
      raw !== '' && Number.isFinite(Number.parseFloat(raw)) ? [[k, Number.parseFloat(raw)]] : [],
    ),
  );
  const out = safeCalculate(type, inputs);

  return (
    <section
      aria-labelledby="play-title"
      className="border-line bg-panel flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="play-title" className="text-muted text-sm font-semibold">
        {t('calc.playground')}
      </h2>
      <label className="flex flex-col gap-1 text-xs font-medium sm:w-72">
        {t('calc.type')}
        <select
          value={type}
          onChange={(e) => {
            const next = e.target.value as CalcType;
            setType(next);
            setValues(
              Object.fromEntries(
                Object.entries(defaultInputs(next)).map(([k, v]) => [k, String(v)]),
              ),
            );
          }}
          className="border-line bg-canvas text-fg focus-visible:outline-accent rounded-md border px-2 py-1.5 text-sm font-normal focus-visible:outline-2"
        >
          {CALC_TYPES.map((c) => (
            <option key={c} value={c}>
              {t(`calc.type.${c}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-3">
        {fields.map((f) => (
          <NumberField
            key={f.key}
            label={f.key}
            unit={f.unit}
            optional={f.optional}
            value={values[f.key] ?? ''}
            onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
          />
        ))}
      </div>
      {'res' in out ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold tabular-nums">{formatResult(out.res)}</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[out.res.status]}`}
            >
              {t(`calc.status.${out.res.status}` as MessageKey)}
            </span>
          </div>
          <p className="text-muted font-mono text-xs">{out.res.formula}</p>
          <Extras res={out.res} />
        </div>
      ) : (
        <p role="alert" className="bg-danger-bg text-danger-fg rounded-md px-3 py-2 text-xs">
          {t('calc.error')}: {out.error}
        </p>
      )}
    </section>
  );
}

export function CalcView({ board }: { board: BoardDef }) {
  const t = useT();
  const project = useWorkspace((s) => s.project);
  const projectId = useWorkspace((s) => s.projectId);
  return (
    <div className="flex w-full flex-col gap-5 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('calc.title')}</h1>
        <p className="text-muted mt-1 text-sm">{t('calc.hint')}</p>
      </header>
      {project.calculations.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {project.calculations.map((c) => (
            <CalcCard key={c.id} calc={c} projectId={projectId} />
          ))}
        </div>
      )}
      <CircuitAnalysis board={board} />
      <Playground />
    </div>
  );
}
