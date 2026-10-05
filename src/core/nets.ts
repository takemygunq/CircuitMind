import type { Project } from './schema';

export interface Net {
  id: number;
  name: string;
  endpoints: string[];
  /** Индексы соединений проекта, входящих в цепь. */
  connections: number[];
}

export interface NetMap {
  nets: Net[];
  netOfEndpoint: ReadonlyMap<string, number>;
  netOfConnection: readonly number[];
}

/** Объединяет соединения проекта в электрические цепи (union-find по endpoint'ам). */
export function computeNets(project: Pick<Project, 'connections'>): NetMap {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    if (!parent.has(a)) parent.set(a, a);
    const p = parent.get(a)!;
    if (p === a) return a;
    const root = find(p);
    parent.set(a, root);
    return root;
  };
  for (const c of project.connections) parent.set(find(c.from), find(c.to));

  const byRoot = new Map<string, Net>();
  const netOfConnection: number[] = [];
  const netOfEndpoint = new Map<string, number>();
  project.connections.forEach((c, i) => {
    const root = find(c.from);
    let net = byRoot.get(root);
    if (!net) {
      net = { id: byRoot.size, name: '', endpoints: [], connections: [] };
      byRoot.set(root, net);
    }
    net.connections.push(i);
    for (const e of [c.from, c.to]) if (!net.endpoints.includes(e)) net.endpoints.push(e);
    if (!net.name && c.netName) net.name = c.netName;
    netOfConnection.push(net.id);
  });
  const nets = [...byRoot.values()];
  for (const n of nets) {
    if (!n.name) n.name = `NET${n.id + 1}`;
    n.endpoints.forEach((e) => netOfEndpoint.set(e, n.id));
  }
  return { nets, netOfEndpoint, netOfConnection };
}
