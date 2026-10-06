import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/cyfi-test-${process.pid}-${Date.now()}`;
  process.env.HUNT_DATA_DIR = dir;
  return dir;
});

vi.mock("@/lib/hunt/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hunt/engine")>()),
  findTarget: vi.fn(),
}));
vi.mock("@/lib/hunt/check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hunt/check")>()),
  compareWithTarget: vi.fn(),
}));

import { findTarget, type EngineResult } from "@/lib/hunt/engine";
import { compareWithTarget } from "@/lib/hunt/check";
import { ModelUnavailableError } from "@/lib/hunt/ollama";
import { checkFound, confirmFound, forgetRound, getRound, getRoundImage, revealRound, startRound, unlockHint, type StartEvent } from "./service";
import { loadRound } from "./store";

const photo = (w = 1600, h = 1200) => sharp({ create: { width: w, height: h, channels: 3, background: "#6b705c" } }).jpeg().toBuffer();

const chosenResult: EngineResult = {
  candidates: [
    { idx: 0, label: "small brass plaque dated 1919", box_2d: [500, 100, 560, 160], box: { x: 0.1, y: 0.5, w: 0.06, h: 0.06 } },
  ],
  chosen: 0,
  texts: {
    lens: "remember",
    clue: "Someone wanted this place to remember something.",
    evidence: "a year is engraved",
    hint_semantic: "It marks a moment in this place's history.",
    hint_concrete: "Small brass rectangle at eye level.",
    detail: "The year 1919 is engraved on it.",
  },
  steps: [],
  waitMs: 1000,
};

async function newRound(result: EngineResult = chosenResult) {
  vi.mocked(findTarget).mockResolvedValueOnce(structuredClone(result));
  const events: StartEvent[] = [];
  await startRound(await photo(), (e) => events.push(e));
  const created = events.find((e) => e.type === "created") as Extract<StartEvent, { type: "created" }>;
  return { id: created?.id, events };
}

beforeEach(() => {
  vi.mocked(findTarget).mockReset();
  vi.mocked(compareWithTarget).mockReset();
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("startRound", () => {
  it("streams created → progress → done and stores a secret target", async () => {
    const { id, events } = await newRound();
    expect(events.map((e) => e.type)).toEqual(["created", "progress", "done"]);
    const done = events.at(-1) as Extract<StartEvent, { type: "done" }>;
    expect(done.round.status).toBe("hunting");
    expect(done.round.clue).toBe("Someone wanted this place to remember something.");
    // The device never sees the label or the box before the end.
    expect(JSON.stringify(done.round)).not.toContain("brass");
    expect(done.round.reveal).toBeUndefined();
    const stored = await loadRound(id);
    expect(stored?.target?.label).toBe("small brass plaque dated 1919");
    expect(stored?.target?.hints.spatial).toMatch(/left/);
  });

  it("forwards the engine's progress as stages", async () => {
    vi.mocked(findTarget).mockImplementationOnce(async (_img, _opts, onProgress) => {
      onProgress?.({ stage: "verifying", attempt: 1 });
      onProgress?.({ stage: "verifying", attempt: 2 });
      onProgress?.({ stage: "chosen", idx: 0 });
      return structuredClone(chosenResult);
    });
    const events: StartEvent[] = [];
    await startRound(await photo(), (e) => events.push(e));
    expect(events.filter((e) => e.type === "progress").map((e) => (e as { stage: string }).stage)).toEqual(["looking", "checking", "checking", "writing"]);
  });

  it("ends with status none when nothing verifies", async () => {
    const { events } = await newRound({ candidates: [], steps: [], waitMs: 1 });
    expect((events.at(-1) as Extract<StartEvent, { type: "done" }>).round.status).toBe("none");
  });

  it("falls back to safe texts when the writer failed", async () => {
    const { id } = await newRound({ ...chosenResult, texts: undefined });
    const r = await getRound(id);
    expect(r?.status).toBe("hunting");
    expect(r?.clue).toBe("Someone wanted this place to remember something.");
  });

  it("reports an unreadable photo without creating a round", async () => {
    const events: StartEvent[] = [];
    await startRound(Buffer.from("nope"), (e) => events.push(e));
    expect(events).toEqual([{ type: "error", code: "bad_photo", message: expect.any(String) }]);
  });

  it("reports a missing model as model_unavailable and keeps the round as error", async () => {
    vi.mocked(findTarget).mockRejectedValueOnce(new ModelUnavailableError(new Error("ECONNREFUSED")));
    const events: StartEvent[] = [];
    await startRound(await photo(), (e) => events.push(e));
    const err = events.at(-1) as Extract<StartEvent, { type: "error" }>;
    expect(err.code).toBe("model_unavailable");
    expect((await getRound(err.id!))?.status).toBe("error");
  });

  it("finishes even if the phone stops listening", async () => {
    vi.mocked(findTarget).mockResolvedValueOnce(structuredClone(chosenResult));
    let id = "";
    await startRound(await photo(), (e) => {
      if (e.type === "created") id = e.id;
      else throw new Error("stream closed");
    });
    expect((await getRound(id))?.status).toBe("hunting");
  });
});

describe("hints", () => {
  it("unlock one level at a time and stop at four", async () => {
    const { id } = await newRound();
    const levels = [];
    for (let i = 0; i < 6; i++) levels.push((await unlockHint(id)).hints.map((h) => h.kind));
    expect(levels[0]).toEqual(["text"]);
    expect(levels[2]).toEqual(["text", "text", "text"]);
    expect(levels[3]).toEqual(["text", "text", "text", "image"]);
    expect(levels[5]).toEqual(levels[3]);
    expect((await getRound(id))?.hintsLeft).toBe(0);
  });

  it("the blurred image is only served after the last hint", async () => {
    const { id } = await newRound();
    expect(await getRoundImage(id, "hint")).toBeUndefined();
    for (let i = 0; i < 4; i++) await unlockHint(id);
    expect(await getRoundImage(id, "hint")).toBeInstanceOf(Buffer);
  });

  it("concurrent taps don't skip levels", async () => {
    const { id } = await newRound();
    await Promise.all([unlockHint(id), unlockHint(id), unlockHint(id)]);
    expect((await getRound(id))?.hints).toHaveLength(3);
  });
});

describe("checking a find", () => {
  it("NOT QUITE keeps the round going and reveals nothing", async () => {
    const { id } = await newRound();
    vi.mocked(compareWithTarget).mockResolvedValueOnce({ verdict: "not_quite", shows: "a bench", details: [], ms: 5 });
    const { verdict, round } = await checkFound(id, await photo(800, 600));
    expect(verdict).toBe("not_quite");
    expect(round.status).toBe("hunting");
    expect(round.reveal).toBeUndefined();
    expect(await getRoundImage(id, "reveal")).toBeUndefined();
  });

  it("ALMOST keeps the round going", async () => {
    const { id } = await newRound();
    vi.mocked(compareWithTarget).mockResolvedValueOnce({ verdict: "almost", shows: "another plaque", details: [], ms: 5 });
    expect((await checkFound(id, await photo())).round.status).toBe("hunting");
  });

  it("FOUND ends the round and unlocks the reveal", async () => {
    const { id } = await newRound();
    vi.mocked(compareWithTarget).mockResolvedValueOnce({ verdict: "found", shows: "the plaque", details: [], ms: 5 });
    const { verdict, round } = await checkFound(id, await photo());
    expect(verdict).toBe("found");
    expect(round.status).toBe("found");
    expect(round.reveal?.label).toBe("small brass plaque dated 1919");
    expect(round.reveal?.foundPhotoUrl).toMatch(/found-1$/);
    expect(await getRoundImage(id, "reveal")).toBeInstanceOf(Buffer);
    await expect(unlockHint(id)).rejects.toMatchObject({ code: "wrong_state" });
  });

  it("the player can overrule a NOT QUITE; it is logged as an override", async () => {
    const { id } = await newRound();
    await expect(confirmFound(id)).rejects.toMatchObject({ code: "wrong_state" });
    vi.mocked(compareWithTarget).mockResolvedValueOnce({ verdict: "not_quite", shows: "?", details: [], ms: 5 });
    await checkFound(id, await photo());
    const r = await confirmFound(id);
    expect(r.status).toBe("found");
    const log = await fs.readFile(path.join(dataDir, "fieldlog.jsonl"), "utf8");
    expect(log).toContain('"event":"player_override"');
  });

  it("an unreadable close-up is a bad photo, not a verdict", async () => {
    const { id } = await newRound();
    await expect(checkFound(id, Buffer.from("x"))).rejects.toMatchObject({ code: "bad_photo" });
    expect(vi.mocked(compareWithTarget)).not.toHaveBeenCalled();
  });
});

describe("giving up and resuming", () => {
  it("reveal ends the round and shows the target", async () => {
    const { id } = await newRound();
    const r = await revealRound(id);
    expect(r.status).toBe("revealed");
    expect(r.reveal?.detail).toBe("The year 1919 is engraved on it.");
    await expect(revealRound(id)).rejects.toMatchObject({ code: "wrong_state" });
  });

  it("a round can be fetched again after a reload", async () => {
    const { id } = await newRound();
    await unlockHint(id);
    const again = await getRound(id);
    expect(again?.status).toBe("hunting");
    expect(again?.hints).toHaveLength(1);
  });

  it("unknown and malformed ids are simply not found", async () => {
    expect(await getRound("00000000-0000-0000-0000-000000000000")).toBeUndefined();
    expect(await getRound("../../etc/passwd")).toBeUndefined();
    expect(await getRoundImage("../../etc", "photo")).toBeUndefined();
    await expect(unlockHint("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("the wide photo is hidden while hunting, so the player looks at the place", async () => {
    const { id } = await newRound();
    expect(await getRoundImage(id, "photo")).toBeUndefined();
    await revealRound(id);
    expect(await getRoundImage(id, "photo")).toBeInstanceOf(Buffer);
  });
});

describe("forgetting a place", () => {
  it("deletes the round's photos from disk", async () => {
    const { id } = await newRound();
    await revealRound(id);
    await forgetRound(id);
    expect(await getRound(id)).toBeUndefined();
    await expect(fs.stat(path.join(dataDir, "rounds", id))).rejects.toThrow();
    await expect(forgetRound(id)).rejects.toMatchObject({ code: "not_found" });
  });
});
