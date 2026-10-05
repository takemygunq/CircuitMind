import { z } from 'zod';
import { Project } from '@/core/schema';
import { handle } from '@/server/providers/http';
import { SAVED_ID, listProjects, saveProject } from '@/server/projects/store';

const MAX_BYTES = 400_000;
const Body = z.object({ project: Project, id: z.string().regex(SAVED_ID).optional() });

/** Сохранённые проекты этого сервера (без аккаунтов — как настройки, только с этого компьютера). */
export const GET = (req: Request) => handle(req, () => ({ projects: listProjects() }));

export const POST = (req: Request) =>
  handle(req, async () => {
    const text = await req.text();
    if (text.length > MAX_BYTES) throw new Error('Project is too large');
    const { project, id } = Body.parse(JSON.parse(text));
    return { saved: saveProject(project, id) };
  });
