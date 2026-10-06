import { startRound, type StartEvent } from "@/lib/rounds/service";
import { readPhoto } from "../_lib/http";

/**
 * POST a wide photo (multipart field "photo"). The response is NDJSON: one
 * event per line (created → progress… → done | error), so the phone can show
 * what the model is doing while it looks.
 */
export async function POST(request: Request) {
  const photo = await readPhoto(request);
  if (photo instanceof Response) return photo;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const emit = (e: StartEvent) => {
        if (open) controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      startRound(photo, emit)
        .catch((e) => {
          console.error(e);
          emit({ type: "error", code: "internal", message: "Something went wrong while looking." });
        })
        .finally(() => {
          open = false;
          try {
            controller.close();
          } catch {
            // already closed by a disconnect
          }
        });
    },
    cancel() {
      // The client went away; startRound keeps going and saves the round.
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
