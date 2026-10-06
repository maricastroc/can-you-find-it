import { forgetRound, getRound } from "@/lib/rounds/service";
import { errorResponse, fromError } from "../../_lib/http";

export async function GET(_request: Request, ctx: RouteContext<"/api/rounds/[id]">) {
  const { id } = await ctx.params;
  const round = await getRound(id);
  if (!round) return errorResponse("not_found", "This round doesn't exist anymore.");
  return Response.json(round, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/rounds/[id]">) {
  const { id } = await ctx.params;
  try {
    await forgetRound(id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return fromError(e);
  }
}
