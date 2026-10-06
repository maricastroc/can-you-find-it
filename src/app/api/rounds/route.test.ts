import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.HUNT_DATA_DIR = `${process.env.TMPDIR ?? "/tmp"}/cyfi-route-test-${process.pid}`;
});

vi.mock("@/lib/rounds/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rounds/service")>()),
  startRound: vi.fn(async (_photo: Buffer, emit: (e: unknown) => void) => {
    emit({ type: "created", id: "abc" });
    emit({ type: "progress", stage: "looking" });
    emit({ type: "done", round: { id: "abc", status: "none" } });
  }),
}));

import { POST } from "./route";
import { GET as getImage } from "./[id]/image/[kind]/route";
import { POST as postHint } from "./[id]/hint/route";
import { POST as postFeedback } from "./[id]/feedback/route";
import { MAX_UPLOAD_BYTES } from "../_lib/http";

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) }) as never;

function photoRequest(bytes: BlobPart = "jpeg-bytes", field = "photo") {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type: "image/jpeg" }), "p.jpg");
  return new Request("http://localhost/api/rounds", { method: "POST", body: form });
}

describe("POST /api/rounds", () => {
  it("streams NDJSON events", async () => {
    const res = await POST(photoRequest());
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(["created", "progress", "done"]);
  });

  it("rejects a request without a photo", async () => {
    const res = await POST(photoRequest("x", "picture"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_photo");
  });

  it("rejects a body that isn't form data", async () => {
    const res = await POST(new Request("http://localhost/api/rounds", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(400);
  });

  it("rejects oversized uploads before reading them", async () => {
    const req = new Request("http://localhost/api/rounds", {
      method: "POST",
      body: "x",
      headers: { "content-length": String(MAX_UPLOAD_BYTES + 1), "content-type": "multipart/form-data; boundary=x" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("round sub-routes", () => {
  it("unknown rounds are 404 with a JSON error", async () => {
    const res = await postHint(new Request("http://localhost", { method: "POST" }), ctx({ id: "00000000-0000-0000-0000-000000000000" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("images for unknown rounds or kinds are 404", async () => {
    expect((await getImage(new Request("http://localhost"), ctx({ id: "nope", kind: "photo" }))).status).toBe(404);
    expect((await getImage(new Request("http://localhost"), ctx({ id: "00000000-0000-0000-0000-000000000000", kind: "../../x" }))).status).toBe(404);
  });

  it("feedback must be a known kind", async () => {
    const res = await postFeedback(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ kind: "rm -rf" }) }),
      ctx({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(400);
  });
});
