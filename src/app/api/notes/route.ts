import { headers } from "next/headers";
import { isLocalHost, loadRows, summarize, toCsv } from "@/lib/rounds/notes";
import { errorResponse } from "../_lib/http";

export async function GET(request: Request) {
  if (!isLocalHost((await headers()).get("host"))) return errorResponse("not_found", "Not available.");
  const rows = await loadRows();
  if (new URL(request.url).searchParams.get("format") === "csv") {
    return new Response(toCsv(rows), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="field-notes.csv"' },
    });
  }
  return Response.json({ summary: summarize(rows), rounds: rows });
}
