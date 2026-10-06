import { unlockHint } from "@/lib/rounds/service";
import { fromError } from "../../../_lib/http";

export async function POST(_request: Request, ctx: RouteContext<"/api/rounds/[id]/hint">) {
  const { id } = await ctx.params;
  try {
    return Response.json(await unlockHint(id));
  } catch (e) {
    return fromError(e);
  }
}
