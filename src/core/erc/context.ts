import { getBoard, getComponent } from '../library';
import { computeNets, type NetMap } from '../nets';
import {
  parseEndpoint,
  type BoardDef,
  type ComponentDef,
  type PartInstance,
  type PinDef,
  type Project,
} from '../schema';
import { parseOhms } from '../units';
import type { RuleId, Severity, Violation } from './types';

export interface Ep {
  endpoint: string;
  ref: string;
  pinId: string;
  isBoard: boolean;
  part?: PartInstance;
  def?: ComponentDef;
  pin?: PinDef;
  netId?: number;
}

export interface ErcOptions {
  /** Плата, если её нет во встроенной библиотеке (сгенерирована ИИ). */
  board?: BoardDef;
  getComponent?: (id: string) => ComponentDef | undefined;
}

const MIN_SERIES_OHM = 25; // выходное сопротивление пина МК при прямом включении нагрузки
const WIFI_RE = /wi-?fi|esp-?now|mqtt|http|telegram|blynk|интернет|облак|хмар|cloud/i;

/** Вычисленные факты о проекте, общие для всех правил. */
export class ErcContext {
  readonly nets: NetMap;
  readonly parts = new Map<string, { inst: PartInstance; def: ComponentDef | undefined }>();
  readonly violations: Violation[] = [];
  private readonly epCache = new Map<string, Ep>();

  constructor(
    readonly project: Project,
    readonly board: BoardDef,
    opts: ErcOptions = {},
  ) {
    this.nets = computeNets(project);
    const lookup = opts.getComponent ?? getComponent;
    for (const inst of project.parts)
      this.parts.set(inst.instanceId, { inst, def: lookup(inst.componentId) });
  }

  add(rule: RuleId, severity: Severity, refs: string[], params: Violation['params'] = {}): void {
    this.violations.push({ rule, severity, refs, params });
  }

  ep(endpoint: string): Ep {
    let e = this.epCache.get(endpoint);
    if (e) return e;
    const { ref, pin: pinId } = parseEndpoint(endpoint);
    const isBoard = ref === 'board';
    const part = isBoard ? undefined : this.parts.get(ref)?.inst;
    const def = isBoard ? undefined : this.parts.get(ref)?.def;
    const pin = isBoard
      ? this.board.pins.find((p) => p.id === pinId)
      : def?.pins.find((p) => p.id === pinId);
    e = {
      endpoint,
      ref,
      pinId,
      isBoard,
      part,
      def,
      pin,
      netId: this.nets.netOfEndpoint.get(endpoint),
    };
    this.epCache.set(endpoint, e);
    return e;
  }

  netEps(netId: number): Ep[] {
    return this.nets.nets[netId].endpoints.map((e) => this.ep(e));
  }

  netOf(ref: string, pinId: string): number | undefined {
    return this.nets.netOfEndpoint.get(`${ref}:${pinId}`);
  }

  /** Кроме платы: детали проекта с известным определением. */
  *knownParts(): Generator<{ inst: PartInstance; def: ComponentDef }> {
    for (const { inst, def } of this.parts.values()) if (def) yield { inst, def };
  }

  isGnd(e: Ep): boolean {
    return !!e.pin && (e.pin.electrical === 'gnd' || e.pin.functions.includes('gnd'));
  }

  isSupplyPin(e: Ep): boolean {
    return (
      e.isBoard &&
      !!e.pin &&
      !this.isGnd(e) &&
      (e.pin.electrical === 'power_out' || this.board.supply.pins.includes(e.pin.id))
    );
  }

  /** Напряжение источника питания платы на пине (VIN → напряжение источника проекта). */
  supplyVoltage(e: Ep): number | undefined {
    if (!e.pin) return undefined;
    if (this.board.supply.pins.includes(e.pin.id) && e.pin.electrical === 'power_in')
      return this.project.power.voltage;
    return e.pin.voltage;
  }

  hasGnd(netId: number): boolean {
    return this.netEps(netId).some((e) => e.isBoard && this.isGnd(e));
  }

  /** Напряжение цепи, если она напрямую подключена к питанию (≠0) или земле платы. */
  netVoltage(netId: number | undefined): number | undefined {
    if (netId === undefined) return undefined;
    let v: number | undefined;
    for (const e of this.netEps(netId)) {
      if (!e.isBoard) continue;
      if (this.isGnd(e)) return 0;
      if (this.isSupplyPin(e)) v = this.supplyVoltage(e);
    }
    return v;
  }

  isRail(netId: number | undefined): boolean {
    return (
      netId !== undefined &&
      this.netEps(netId).some((e) => e.isBoard && (this.isGnd(e) || this.isSupplyPin(e)))
    );
  }

  kind(e: Ep): string | undefined {
    return e.def?.kind;
  }

  ohms(e: Ep): number {
    if (e.def?.kind !== 'resistor') return NaN;
    return e.part?.value ? parseOhms(e.part.value) : NaN;
  }

  param(def: ComponentDef | undefined, key: string): number | undefined {
    const v = def?.params[key];
    return typeof v === 'number' ? v : undefined;
  }

  /** Другой вывод двухвыводного компонента (резистор, диод). */
  otherPin(e: Ep): Ep | undefined {
    if (!e.def || e.def.pins.length !== 2) return undefined;
    const other = e.def.pins.find((p) => p.id !== e.pinId);
    return other ? this.ep(`${e.ref}:${other.id}`) : undefined;
  }

  /** Уровень сигнала на пине: собственный, либо напряжение опорного питания модуля. */
  signalVoltage(e: Ep): number | undefined {
    if (!e.pin) return undefined;
    if (e.pin.voltage !== undefined) return e.pin.voltage;
    if (e.isBoard) return this.board.logicVoltage;
    if (e.pin.referenceSupply) return this.netVoltage(this.netOf(e.ref, e.pin.referenceSupply));
    return undefined;
  }

  maxInputV(e: Ep): number | undefined {
    if (!e.pin) return undefined;
    if (e.pin.maxInputV !== undefined) return e.pin.maxInputV;
    return e.isBoard ? this.board.logicVoltage + 0.3 : undefined;
  }

  minHighV(e: Ep): number | undefined {
    if (!e.pin) return undefined;
    if (e.pin.minHighV !== undefined) return e.pin.minHighV;
    return e.isBoard
      ? this.board.logicVoltage * (this.board.logicVoltage > 4 ? 0.6 : 0.7)
      : undefined;
  }

  /** Типичный ток питания детали, мА. */
  supplyMa(def: ComponentDef | undefined): number {
    return (
      this.param(def, 'currentMa') ??
      this.param(def, 'runCurrentMa') ??
      this.param(def, 'coilCurrentMa') ??
      this.param(def, 'idleCurrentMa') ??
      0
    );
  }

  usesWifi(): boolean {
    const p = this.project;
    return (
      (p.codeHints?.libraries ?? []).some((l) => WIFI_RE.test(l)) ||
      WIFI_RE.test(`${p.title} ${p.description}`)
    );
  }

  /**
   * Оценка тока, который цепь отдаёт нагрузкам при напряжении v, мА.
   * load — светодиоды, базы транзисторов и питание модулей; pull — токи через подтягивающие резисторы
   * (учитываются отдельно: это не «нагрузка» для логики вроде input-only).
   * Обход идёт через резисторы; цепи, подключённые к питанию/земле платы, считаются концом пути.
   */
  netLoad(startNet: number, v: number, startEp?: string): { loadMa: number; pullMa: number } {
    const visited = new Set<number>([startNet]);
    let loadMa = 0;
    let pullMa = 0;
    const explore = (netId: number, rAcc: number, first: boolean): void => {
      if (!first && this.isRail(netId)) {
        const vr = this.netVoltage(netId) ?? 0;
        if (rAcc > 0) pullMa += (Math.max(0, Math.abs(v - vr)) / rAcc) * 1000;
        return;
      }
      for (const e of this.netEps(netId)) {
        if (e.endpoint === startEp) continue;
        if (e.isBoard) {
          if (rAcc > 0 && !this.isGnd(e)) pullMa += (v / rAcc) * 1000; // другой GPIO в худшем случае притянут цепь к земле
          continue;
        }
        const kind = this.kind(e);
        if (kind === 'led' && e.pinId === 'anode') {
          const vf = this.param(e.def, 'vfV') ?? 2;
          loadMa += (Math.max(0, v - vf) / Math.max(rAcc, MIN_SERIES_OHM)) * 1000;
        } else if (kind === 'npn' && e.pinId === 'B') {
          loadMa += (Math.max(0, v - 0.7) / Math.max(rAcc, MIN_SERIES_OHM)) * 1000;
        } else if (kind === 'resistor') {
          const other = this.otherPin(e);
          const r = this.ohms(e);
          if (other?.netId !== undefined && Number.isFinite(r) && !visited.has(other.netId)) {
            visited.add(other.netId);
            explore(other.netId, rAcc + r, false);
          }
        } else if (e.pin?.electrical === 'power_in') {
          loadMa += this.supplyMa(e.def);
        }
      }
    };
    explore(startNet, 0, true);
    return { loadMa, pullMa };
  }
}

export { MIN_SERIES_OHM };
export function boardFor(project: Project, opts: ErcOptions): BoardDef | undefined {
  return opts.board ?? getBoard(project.boardId);
}
