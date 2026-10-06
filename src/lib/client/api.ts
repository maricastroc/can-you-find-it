/** Browser-side calls to the local API. */
import type { Verdict } from "@/lib/hunt/check";
import type { Feedback, PublicRound } from "@/lib/rounds/types";

export type StartEvent =
  | { type: "created"; id: string }
  | { type: "progress"; stage: "looking" | "checking" | "writing"; attempt?: number }
  | { type: "done"; round: PublicRound }
  | { type: "error"; code: string; message: string; id?: string };

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function json<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  const body = (await res.json().catch(() => undefined)) as { error?: { code: string; message: string } } | undefined;
  throw new ApiError(body?.error?.code ?? "internal", body?.error?.message ?? `Request failed (${res.status}).`, res.status);
}

function offline(e: unknown): never {
  if (e instanceof ApiError) throw e;
  if ((e as Error)?.name === "AbortError") throw e;
  throw new ApiError("offline", "Can't reach the computer running the game. Are you on the same network?");
}

/** Split an NDJSON byte stream into parsed events. */
export async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line) as T;
    }
    if (done) break;
  }
  const rest = buffer.trim();
  if (rest) yield JSON.parse(rest) as T;
}

function photoForm(photo: Blob) {
  const form = new FormData();
  form.append("photo", photo, "photo.jpg");
  return form;
}

export async function startRound(photo: Blob, onEvent: (e: StartEvent) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/rounds", { method: "POST", body: photoForm(photo), signal });
  } catch (e) {
    offline(e);
  }
  if (!res.ok || !res.body) await json(res);
  for await (const event of readNdjson<StartEvent>(res.body!)) onEvent(event);
}

const post = (path: string, init?: RequestInit) =>
  fetch(path, { method: "POST", ...init }).catch(offline);

export const getRound = async (id: string) => json<PublicRound>(await fetch(`/api/rounds/${id}`, { cache: "no-store" }).catch(offline));
export const unlockHint = async (id: string) => json<PublicRound>(await post(`/api/rounds/${id}/hint`));
export const checkFound = async (id: string, photo: Blob) =>
  json<{ verdict: Verdict; round: PublicRound }>(await post(`/api/rounds/${id}/check`, { body: photoForm(photo) }));
export const confirmFound = async (id: string) => json<PublicRound>(await post(`/api/rounds/${id}/confirm`));
export const revealRound = async (id: string) => json<PublicRound>(await post(`/api/rounds/${id}/reveal`));
export const sendFeedback = async (id: string, kind: Feedback["kind"], note?: string) =>
  json<PublicRound>(
    await post(`/api/rounds/${id}/feedback`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, note }) }),
  );
export const warmUp = () => post("/api/health").catch(() => undefined);
export async function forgetRound(id: string): Promise<void> {
  const res = await fetch(`/api/rounds/${id}`, { method: "DELETE" }).catch(offline);
  if (!res.ok) await json(res);
}
