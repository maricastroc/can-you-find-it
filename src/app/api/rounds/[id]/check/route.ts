import { checkFound } from "@/lib/rounds/service";
import { fromError, readPhoto } from "../../../_lib/http";

export async function POST(request: Request, ctx: RouteContext<"/api/rounds/[id]/check">) {
  const { id } = await ctx.params;
  const photo = await readPhoto(request);
  if (photo instanceof Response) return photo;
  try {
    return Response.json(await checkFound(id, photo));
  } catch (e) {
    return fromError(e);
  }
}
