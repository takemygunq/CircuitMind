import { handle } from '@/server/providers/http';
import { refreshModels } from '@/server/providers/store';

/** Подтягивает список моделей у провайдера и сохраняет его. */
export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(req, async () => ({ provider: await refreshModels((await params).id) }));
