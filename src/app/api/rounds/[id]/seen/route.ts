import { claimSeen } from "@/lib/rounds/service";
import { fromError } from "../../../_lib/http";

export async function POST(_request: Request, ctx: RouteContext<"/api/rounds/[id]/seen">) {
  const { id } = await ctx.params;
  try {
    return Response.json(await claimSeen(id));
  } catch (e) {
    return fromError(e);
  }
}
