import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, readNdjson, startRound, unlockHint, type StartEvent } from "./api";

function streamOf(...chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

async function collect<T>(gen: AsyncGenerator<T>) {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe("readNdjson", () => {
  it("handles lines split across chunks", async () => {
    const events = await collect(readNdjson(streamOf('{"type":"crea', 'ted","id":"a"}\n{"type":"progress",', '"stage":"looking"}\n')));
    expect(events).toEqual([{ type: "created", id: "a" }, { type: "progress", stage: "looking" }]);
  });

  it("reads a last line without a trailing newline and skips blank lines", async () => {
    expect(await collect(readNdjson(streamOf('\n{"a":1}\n\n{"b":2}')))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("handles multi-byte characters split between chunks", async () => {
    const bytes = new TextEncoder().encode('{"clue":"café"}\n');
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 12));
        c.enqueue(bytes.slice(12));
        c.close();
      },
    });
    expect(await collect(readNdjson(stream))).toEqual([{ clue: "café" }]);
  });
});

describe("fetch wrappers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("startRound forwards each streamed event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf('{"type":"created","id":"x"}\n{"type":"done","round":{"id":"x"}}\n'))));
    const seen: StartEvent[] = [];
    await startRound(new Blob(["jpeg"]), (e) => seen.push(e));
    expect(seen.map((e) => e.type)).toEqual(["created", "done"]);
  });

  it("server errors become ApiError with the server's code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "wrong_state", message: "Not in play." } }, { status: 409 })));
    await expect(unlockHint("x")).rejects.toMatchObject({ code: "wrong_state", status: 409, message: "Not in play." });
  });

  it("network failures become an offline error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const err = await unlockHint("x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("offline");
  });
});
