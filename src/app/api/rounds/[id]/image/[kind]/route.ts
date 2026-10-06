import { getRoundImage } from "@/lib/rounds/service";
import { errorResponse } from "../../../../_lib/http";

export async function GET(_request: Request, ctx: RouteContext<"/api/rounds/[id]/image/[kind]">) {
  const { id, kind } = await ctx.params;
  const image = await getRoundImage(id, kind);
  if (!image) return errorResponse("not_found", "Not available.");
  return new Response(new Uint8Array(image), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" },
  });
}
