import { startRound, type StartEvent } from "@/lib/rounds/service";
import { readPhoto } from "../_lib/http";

export async function POST(request: Request) {
  const photo = await readPhoto(request);
  if (photo instanceof Response) return photo;
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (e: StartEvent) => {
        if (open) controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      startRound(photo, emit)
        .catch((e) => {
          console.error(e);
          emit({ type: "error", code: "internal", message: "Something went wrong while looking." });
        })
        .finally(() => {
          if (open) controller.close();
          open = false;
        });
    },
    cancel() {
      open = false;
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
