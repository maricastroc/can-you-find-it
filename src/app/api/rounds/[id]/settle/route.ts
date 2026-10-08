import { settleClaim } from "@/lib/rounds/service";
import { errorResponse, fromError } from "../../../_lib/http";

export async function POST(request: Request, ctx: RouteContext<"/api/rounds/[id]/settle">) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => undefined)) as { sawIt?: unknown } | undefined;
  if (typeof body?.sawIt !== "boolean") return errorResponse("bad_photo", "Say whether this is what you saw.");
  try {
    return Response.json(await settleClaim(id, body.sawIt));
  } catch (e) {
    return fromError(e);
  }
}
