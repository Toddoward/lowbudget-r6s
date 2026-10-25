/**
 * Pages Function: /api/room/:code → Durable Object (bound from worker "r6-matchmaker").
 * Keeps the game same-origin so the browser only needs the Pages URL.
 */
import { normalizeRoomCode } from '../../../shared/constants.ts';

interface DONamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(req: Request): Promise<Response> };
}
interface Env { ROOMS: DONamespaceLike }
interface Ctx { request: Request; env: Env; params: { code?: string | string[] } }

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  const raw = Array.isArray(ctx.params.code) ? ctx.params.code[0] : ctx.params.code ?? '';
  const code = normalizeRoomCode(decodeURIComponent(raw));
  if (!code) return new Response('invalid room code (expected R6-0000)', { status: 400 });
  if (!ctx.env.ROOMS) return new Response('ROOMS Durable Object binding missing — deploy worker/ first', { status: 503 });
  const stub = ctx.env.ROOMS.get(ctx.env.ROOMS.idFromName(code));
  const url = new URL(ctx.request.url);
  return stub.fetch(new Request(new URL(`/room/${code}`, url.origin), ctx.request));
};
