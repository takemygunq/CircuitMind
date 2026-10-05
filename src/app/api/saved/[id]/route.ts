import { handle } from '@/server/providers/http';
import { deleteProject, loadProject } from '@/server/projects/store';
import { NotFoundError } from '@/server/providers/store';

type Ctx = { params: Promise<{ id: string }> };

export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async () => {
    const found = loadProject((await params).id);
    if (!found) throw new NotFoundError('not found');
    return found;
  });

export const DELETE = (req: Request, { params }: Ctx) =>
  handle(req, async () => {
    if (!deleteProject((await params).id)) throw new NotFoundError('not found');
    return { ok: true };
  });
