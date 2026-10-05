import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Project } from '@/core/schema';
import { dataDir } from '../data-dir';

export interface SavedMeta {
  id: string;
  title: string;
  boardId: string;
  updatedAt: number;
}
export const SAVED_ID = /^[a-z0-9]{8,16}$/;

const dir = () => {
  const d = path.join(dataDir(), 'projects');
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const fileOf = (id: string) => {
  if (!SAVED_ID.test(id)) throw new Error('Invalid project id');
  return path.join(dir(), `${id}.json`);
};

/** Сохраняет проект (новый id или перезапись существующего). Запись атомарная. */
export function saveProject(project: Project, id?: string): SavedMeta {
  const key = id ?? crypto.randomBytes(6).toString('hex');
  const meta: SavedMeta = {
    id: key,
    title: project.title,
    boardId: project.boardId,
    updatedAt: Date.now(),
  };
  const file = fileOf(key);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ meta, project }));
  fs.renameSync(tmp, file);
  return meta;
}

export function loadProject(id: string): { meta: SavedMeta; project: Project } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(fileOf(id), 'utf8')) as {
      meta: SavedMeta;
      project: unknown;
    };
    const project = Project.safeParse(raw.project);
    return project.success ? { meta: raw.meta, project: project.data } : null;
  } catch {
    return null;
  }
}

export function listProjects(): SavedMeta[] {
  const out: SavedMeta[] = [];
  for (const f of fs.readdirSync(dir())) {
    const id = f.replace(/\.json$/, '');
    if (!SAVED_ID.test(id) || !f.endsWith('.json')) continue;
    const p = loadProject(id);
    if (p) out.push(p.meta);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteProject(id: string): boolean {
  try {
    fs.rmSync(fileOf(id));
    return true;
  } catch {
    return false;
  }
}
