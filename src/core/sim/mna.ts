/**
 * Решатель цепей постоянного тока методом узловых потенциалов (MNA) с итерациями Ньютона.
 * Узел 0 — земля. Элемент описывает токи, втекающие в его выводы, и якобиан по напряжениям узлов:
 * линейные элементы дают постоянный якобиан, нелинейные (диоды, транзисторы) линеаризуются на каждой итерации.
 */

export interface Element {
  /** Узлы выводов (0 — земля). */
  nodes: number[];
  /** Токи, втекающие в элемент через каждый вывод, и якобиан d(i_r)/d(v_c). */
  eval(v: number[]): { i: number[]; J: number[][] };
}

export interface SolveOptions {
  maxIter?: number;
  /** Максимальное изменение напряжения узла за итерацию, В (демпфирование Ньютона). */
  maxStep?: number;
  vtol?: number;
  gmin?: number;
  initial?: number[];
}

export interface SolveResult {
  /** Напряжения узлов, v[0] = 0. */
  v: number[];
  converged: boolean;
  iterations: number;
  /** Матрица оказалась вырожденной. */
  singular: boolean;
}

/** Решение A·x = b гауссовым исключением с выбором главного элемента. null — вырожденная система. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-30) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

function newton(
  nNodes: number,
  elements: Element[],
  o: Required<Omit<SolveOptions, 'initial'>> & { initial: number[] },
): SolveResult {
  const m = nNodes - 1;
  const v = o.initial.slice();
  v[0] = 0;
  if (m === 0) return { v, converged: true, iterations: 0, singular: false };
  for (let iter = 1; iter <= o.maxIter; iter++) {
    const A = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    const b = new Array<number>(m).fill(0);
    for (const el of elements) {
      const vv = el.nodes.map((k) => v[k]);
      const { i, J } = el.eval(vv);
      for (let r = 0; r < el.nodes.length; r++) {
        const a = el.nodes[r];
        if (a === 0) continue;
        let rhs = -i[r];
        for (let c = 0; c < el.nodes.length; c++) {
          rhs += J[r][c] * vv[c];
          const bn = el.nodes[c];
          if (bn !== 0) A[a - 1][bn - 1] += J[r][c];
        }
        b[a - 1] += rhs;
      }
    }
    for (let k = 0; k < m; k++) A[k][k] += o.gmin;
    const x = solveLinear(A, b);
    if (!x) return { v, converged: false, iterations: iter, singular: true };

    let maxDelta = 0;
    for (let k = 0; k < m; k++) maxDelta = Math.max(maxDelta, Math.abs(x[k] - v[k + 1]));
    const scale = maxDelta > o.maxStep ? o.maxStep / maxDelta : 1;
    let converged = true;
    for (let k = 0; k < m; k++) {
      const next = v[k + 1] + scale * (x[k] - v[k + 1]);
      if (Math.abs(next - v[k + 1]) > o.vtol * (1 + Math.abs(next)) || scale < 1) converged = false;
      v[k + 1] = next;
    }
    if (converged) return { v, converged: true, iterations: iter, singular: false };
  }
  return { v, converged: false, iterations: o.maxIter, singular: false };
}

/** Решает цепь. Если прямой Ньютон не сошёлся, повторяет с постепенным уменьшением gmin (gmin stepping). */
export function solveDc(nNodes: number, elements: Element[], opts: SolveOptions = {}): SolveResult {
  const base = {
    maxIter: opts.maxIter ?? 150,
    maxStep: opts.maxStep ?? 1,
    vtol: opts.vtol ?? 1e-9,
    gmin: opts.gmin ?? 1e-12,
  };
  const initial = opts.initial ?? new Array<number>(nNodes).fill(0);
  const direct = newton(nNodes, elements, { ...base, initial });
  if (direct.converged || direct.singular) return direct;

  let guess = initial;
  let total = direct.iterations;
  for (const g of [1e-2, 1e-4, 1e-6, 1e-8, 1e-10, base.gmin]) {
    const r = newton(nNodes, elements, { ...base, gmin: g, initial: guess });
    total += r.iterations;
    guess = r.v;
    if (g === base.gmin) return { ...r, iterations: total };
    if (r.singular) return { ...r, iterations: total };
  }
  return direct;
}

// ───────── линейные элементы ─────────

export function resistor(a: number, b: number, ohms: number): Element {
  const g = 1 / ohms;
  return {
    nodes: [a, b],
    eval: ([va, vb]) => {
      const i = g * (va - vb);
      return {
        i: [i, -i],
        J: [
          [g, -g],
          [-g, g],
        ],
      };
    },
  };
}

/** Источник напряжения v с внутренним сопротивлением r между узлом и землёй (эквивалент Тевенина). */
export function theveninToGround(node: number, volts: number, ohms: number): Element {
  const g = 1 / ohms;
  return { nodes: [node], eval: ([vn]) => ({ i: [g * (vn - volts)], J: [[g]] }) };
}
