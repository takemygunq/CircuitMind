import { z } from 'zod';
import { queryCatalogue } from '@/server/catalogue';

const Query = z.object({
  q: z.string().max(100).optional(),
  category: z.string().max(80).optional(),
  sub: z.string().max(80).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(96).optional(),
});

/** Каталог деталей: поиск, раздел/подраздел и постраничная выдача. */
export async function GET(req: Request) {
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400 });
  return Response.json(queryCatalogue(parsed.data), { headers: { 'cache-control': 'no-store' } });
}
