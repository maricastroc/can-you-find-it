import { confirmFound } from "@/lib/rounds/service";
import { fromError } from "../../../_lib/http";

/** The player overrides a "not quite": logged as a possible false negative. */
export async function POST(_request: Request, ctx: RouteContext<"/api/rounds/[id]/confirm">) {
  const { id } = await ctx.params;
  try {
    return Response.json(await confirmFound(id));
  } catch (e) {
    return fromError(e);
  }
}
