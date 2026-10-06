import { addFeedback } from "@/lib/rounds/service";
import type { Feedback } from "@/lib/rounds/types";
import { errorResponse, fromError } from "../../../_lib/http";

const KINDS: ReadonlyArray<Feedback["kind"]> = ["target_wrong", "box_wrong", "should_have_matched", "should_not_have_matched", "great_moment", "note"];

export async function POST(request: Request, ctx: RouteContext<"/api/rounds/[id]/feedback">) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => undefined)) as { kind?: string; note?: unknown } | undefined;
  const kind = KINDS.find((k) => k === body?.kind);
  if (!kind) return errorResponse("bad_photo", "Unknown feedback kind.");
  const note = typeof body?.note === "string" ? body.note.slice(0, 2000) : undefined;
  try {
    return Response.json(await addFeedback(id, { kind, note }));
  } catch (e) {
    return fromError(e);
  }
}
