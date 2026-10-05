import { Project } from './schema';

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ye',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  і: 'i',
  ї: 'yi',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** Имя файла из названия проекта: латиница, цифры и дефисы. */
export function slugify(title: string, fallback = 'circuitmind-project'): string {
  const latin = [...title.toLowerCase()].map((c) => TRANSLIT[c] ?? c).join('');
  const slug = latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

export const exportFilename = (
  project: Pick<Project, 'title'>,
  suffix: string,
  ext: string,
): string => `${slugify(project.title)}${suffix ? `-${suffix}` : ''}.${ext}`;

export function projectToJson(project: Project): string {
  return JSON.stringify(project, null, 2) + '\n';
}

export const MAX_IMPORT_BYTES = 1_000_000;

export type ImportResult =
  { ok: true; project: Project } | { ok: false; error: string; issues?: string[] };

/** Разбор JSON-файла проекта: ограничение размера, валидный JSON, схема Zod. */
export function parseProjectJson(text: string): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'too_large' };
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, error: 'not_json' };
  }
  const parsed = Project.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      error: 'invalid_project',
      issues: parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  return { ok: true, project: parsed.data };
}
