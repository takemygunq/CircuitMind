import { catalogueLinks } from '@/server/catalogue';

export async function GET() {
  return Response.json(catalogueLinks(), { headers: { 'cache-control': 'no-store' } });
}
