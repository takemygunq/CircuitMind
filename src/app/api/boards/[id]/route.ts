import { getAnyBoard } from '@/server/board-service';

export async function GET(_req: Request, ctx: RouteContext<'/api/boards/[id]'>) {
  const { id } = await ctx.params;
  const board = await getAnyBoard(id);
  if (!board) return Response.json({ error: 'board_not_found' }, { status: 404 });
  return Response.json({ board });
}
