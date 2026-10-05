import { z } from 'zod';
import { handle } from '@/server/providers/http';
import { getActive, setActive } from '@/server/providers/store';

const Body = z.object({
  active: z.object({ providerId: z.string(), modelId: z.string().min(1).max(200) }).nullable(),
});

/** Какой моделью отвечает сервер. null — ключ Anthropic из окружения (ANTHROPIC_API_KEY). */
export const GET = (req: Request) => handle(req, () => ({ active: getActive() }));

export const PUT = (req: Request) =>
  handle(req, async () => {
    setActive(Body.parse(await req.json()).active);
    return { active: getActive() };
  });
