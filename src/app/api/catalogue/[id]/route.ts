import { catalogueDetail } from '@/server/catalogue';

/** Деталь каталога с аналогами из того же подраздела. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const found = catalogueDetail((await params).id);
  return found ? Response.json(found) : Response.json({ error: 'not_found' }, { status: 404 });
}
