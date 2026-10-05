import { handle } from '@/server/providers/http';
import { checkProvider } from '@/server/providers/store';

/** Проверка подключения: ключ, доступность сервера, вход в CLI. */
export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(req, async () => ({ provider: await checkProvider((await params).id) }));
