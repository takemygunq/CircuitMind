import { listAllBoards } from '@/server/board-service';

export async function GET() {
  return Response.json({ boards: await listAllBoards() });
}
