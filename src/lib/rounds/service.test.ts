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
  writeTexts: vi.fn(),
}));
vi.mock("@/lib/hunt/check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hunt/check")>()),
  judgeFound: vi.fn(),
}));

import { findTarget, writeTexts, type EngineResult, type Texts } from "@/lib/hunt/engine";
import { judgeFound } from "@/lib/hunt/check";
import { ModelUnavailableError } from "@/lib/hunt/ollama";
import {
  checkFound,
  claimSeen,
  confirmFound,
  FALLBACK_HINTS,
  forgetRound,
  getRound,
  getRoundImage,
  revealRound,
  settleClaim,
  settleTexts,
  startRound,
  unlockHint,
  type StartEvent,
} from "./service";
import { loadRound } from "./store";

const photo = (w = 1600, h = 1200) => sharp({ create: { width: w, height: h, channels: 3, background: "#6b705c" } }).jpeg().toBuffer();

const chosenResult: EngineResult = {
  candidates: [
    { idx: 0, label: "small brass plaque dated 1919", box_2d: [500, 100, 560, 160], box: { x: 0.1, y: 0.5, w: 0.06, h: 0.06 } },
  ],
  chosen: 0,
  lens: "remember",
  clue: "Someone wanted this place to remember something.",
  steps: [],
  waitMs: 1000,
};

const texts: Texts = {
  lens: "remember",
  clue: "Someone wanted this place to remember something.",
  evidence: "a year is engraved",
  hint_semantic: "It marks a moment in this place's history.",
  hint_concrete: "Small brass rectangle at eye level.",
  detail: "The year 1919 is engraved on it.",
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function newRound(result: EngineResult = chosenResult, settle = true) {
  vi.mocked(findTarget).mockResolvedValueOnce(structuredClone(result));
  const events: StartEvent[] = [];
  await startRound(await photo(), (e) => events.push(e));
  const created = events.find((e) => e.type === "created") as Extract<StartEvent, { type: "created" }>;
  if (settle && created) await settleTexts(created.id);
  return { id: created?.id, events };
}

beforeEach(() => {
  vi.mocked(findTarget).mockReset();
  vi.mocked(writeTexts).mockReset();
  vi.mocked(writeTexts).mockResolvedValue({ texts, step: { kind: "write", ms: 1, promptTokens: 0, outputTokens: 0, raw: "" } });
  vi.mocked(judgeFound).mockReset();
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
    expect(JSON.stringify(done.round)).not.toContain("brass");
    expect(done.round.reveal).toBeUndefined();
    const stored = await loadRound(id);
    expect(stored?.target?.label).toBe("small brass plaque dated 1919");
    expect(stored?.target?.hints.spatial).toMatch(/left/);
  });

  it("shows the clue before the hints are written", async () => {
    const writer = deferred<Awaited<ReturnType<typeof writeTexts>>>();
    vi.mocked(writeTexts).mockReturnValueOnce(writer.promise);
    const { id, events } = await newRound(chosenResult, false);
    expect((events.at(-1) as Extract<StartEvent, { type: "done" }>).round.clue).toBeDefined();
    expect((await loadRound(id))?.target?.textsReady).toBe(false);
    writer.resolve({ texts, step: { kind: "write", ms: 1, promptTokens: 0, outputTokens: 0, raw: "" } });
    await settleTexts(id);
    const ready = await loadRound(id);
    expect(ready?.target?.textsReady).toBe(true);
    expect(ready?.target?.hints.semantic).toBe(texts.hint_semantic);
    expect(ready?.target?.detail).toBe(texts.detail);
  });

  it("the writer keeps the clue line that was already shown", async () => {
    const { id } = await newRound();
    expect(vi.mocked(writeTexts).mock.calls[0][3]).toBe("remember");
    expect((await getRound(id))?.clue).toBe("Someone wanted this place to remember something.");
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
    await settleTexts((events[0] as Extract<StartEvent, { type: "created" }>).id);
    expect(events.filter((e) => e.type === "progress").map((e) => (e as { stage: string }).stage)).toEqual(["looking", "checking", "checking"]);
  });

  it("ends with status none when nothing verifies, without writing", async () => {
    const { events } = await newRound({ candidates: [], steps: [], waitMs: 1 });
    expect((events.at(-1) as Extract<StartEvent, { type: "done" }>).round.status).toBe("none");
    expect(writeTexts).not.toHaveBeenCalled();
  });

  it("falls back to safe hints when the writer fails", async () => {
    vi.mocked(writeTexts).mockRejectedValueOnce(new Error("model went away"));
    const { id } = await newRound();
    await unlockHint(id);
    const r = await unlockHint(id);
    expect(r.hints.map((h) => (h.kind === "text" ? h.text : ""))).toEqual([FALLBACK_HINTS.semantic, FALLBACK_HINTS.concrete]);
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
    await settleTexts(id);
  });
});

describe("hints", () => {
  it("unlock one level at a time and stop at five", async () => {
    const { id } = await newRound();
    const levels = [];
    for (let i = 0; i < 7; i++) levels.push((await unlockHint(id)).hints.map((h) => h.kind));
    expect(levels[0]).toEqual(["text"]);
    expect(levels[2]).toEqual(["text", "text", "text"]);
    expect(levels[3]).toEqual(["text", "text", "text", "glimpse"]);
    expect(levels[4]).toEqual(["text", "text", "text", "glimpse", "area"]);
    expect(levels[6]).toEqual(levels[4]);
    expect((await getRound(id))?.hintsLeft).toBe(0);
  });

  it("the image hints exist only once they are unlocked", async () => {
    const { id } = await newRound();
    for (let i = 0; i < 3; i++) await unlockHint(id);
    expect(await getRoundImage(id, "hint")).toBeUndefined();
    await unlockHint(id);
    expect(await getRoundImage(id, "hint")).toBeInstanceOf(Buffer);
    expect(await getRoundImage(id, "area")).toBeUndefined();
    const round = await unlockHint(id);
    expect(round.hints.at(-1)).toMatchObject({ level: 5, kind: "area", imageUrl: `/api/rounds/${id}/image/area` });
    expect(await getRoundImage(id, "area")).toBeInstanceOf(Buffer);
  });

  it("an early hint waits for the writer instead of showing an empty hint", async () => {
    const writer = deferred<Awaited<ReturnType<typeof writeTexts>>>();
    vi.mocked(writeTexts).mockReturnValueOnce(writer.promise);
    const { id } = await newRound(chosenResult, false);
    let settled = false;
    const hint = unlockHint(id).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    writer.resolve({ texts, step: { kind: "write", ms: 1, promptTokens: 0, outputTokens: 0, raw: "" } });
    const r = await hint;
    expect(r.hints).toEqual([{ level: 1, kind: "text", text: texts.hint_semantic }]);
  });

  it("the spatial hint needs no writing", async () => {
    const writer = deferred<Awaited<ReturnType<typeof writeTexts>>>();
    vi.mocked(writeTexts).mockReturnValueOnce(writer.promise);
    const { id } = await newRound(chosenResult, false);
    writer.resolve({ texts, step: { kind: "write", ms: 1, promptTokens: 0, outputTokens: 0, raw: "" } });
    await unlockHint(id);
    await unlockHint(id);
    const third = await unlockHint(id);
    expect(third.hints.at(-1)).toMatchObject({ level: 3, kind: "text", text: expect.stringMatching(/left/) });
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

  it("a hint for a round that is over is refused", async () => {
    const { id } = await newRound();
    await revealRound(id);
    await expect(unlockHint(id)).rejects.toMatchObject({ code: "wrong_state" });
  });
});

describe("checking a find", () => {
  it("NOT QUITE keeps the round going and reveals nothing", async () => {
    const { id } = await newRound();
    vi.mocked(judgeFound).mockResolvedValueOnce({ verdict: "not_quite", shows: "a bench", details: [], ms: 5 });
    const { verdict, round } = await checkFound(id, await photo(800, 600));
    expect(verdict).toBe("not_quite");
    expect(round.status).toBe("hunting");
    expect(round.reveal).toBeUndefined();
    expect(await getRoundImage(id, "reveal")).toBeUndefined();
  });

  it("ALMOST keeps the round going", async () => {
    const { id } = await newRound();
    vi.mocked(judgeFound).mockResolvedValueOnce({ verdict: "almost", shows: "another plaque", details: [], ms: 5 });
    expect((await checkFound(id, await photo())).round.status).toBe("hunting");
  });

  it("FOUND ends the round and unlocks the reveal", async () => {
    const { id } = await newRound();
    vi.mocked(judgeFound).mockResolvedValueOnce({ verdict: "found", shows: "the plaque", details: [], ms: 5 });
    const { verdict, round } = await checkFound(id, await photo());
    expect(verdict).toBe("found");
    expect(round.status).toBe("found");
    expect(round.reveal?.label).toBe("small brass plaque dated 1919");
    expect(round.reveal?.detail).toBe("The year 1919 is engraved on it.");
    expect(round.reveal?.foundPhotoUrl).toMatch(/found-1$/);
    expect(await getRoundImage(id, "reveal")).toBeInstanceOf(Buffer);
    await expect(unlockHint(id)).rejects.toMatchObject({ code: "wrong_state" });
  });

  it("the player can overrule a NOT QUITE; it is logged as an override", async () => {
    const { id } = await newRound();
    await expect(confirmFound(id)).rejects.toMatchObject({ code: "wrong_state" });
    vi.mocked(judgeFound).mockResolvedValueOnce({ verdict: "not_quite", shows: "?", details: [], ms: 5 });
    await checkFound(id, await photo());
    const r = await confirmFound(id);
    expect(r.status).toBe("found");
    const log = await fs.readFile(path.join(dataDir, "fieldlog.jsonl"), "utf8");
    expect(log).toContain('"event":"player_override"');
  });

  it("the other things the model proposed are offered as distractors, never the target itself", async () => {
    const result: EngineResult = structuredClone(chosenResult);
    result.candidates.push(
      { idx: 1, label: "red mailbox on the corner", box_2d: [500, 800, 600, 900], box: { x: 0.8, y: 0.5, w: 0.1, h: 0.1 } },
      { idx: 2, label: "brass frame around the plaque", box_2d: [495, 95, 565, 165], box: { x: 0.095, y: 0.495, w: 0.07, h: 0.07 } },
    );
    const { id } = await newRound(result);
    vi.mocked(judgeFound).mockResolvedValueOnce({ verdict: "not_quite", shows: "a bench", details: [], ms: 5 });
    await checkFound(id, await photo());
    const [, , label, others] = vi.mocked(judgeFound).mock.calls[0];
    expect(label).toBe("small brass plaque dated 1919");
    expect(others).toEqual(["red mailbox on the corner"]);
  });

  it("an unreadable close-up is a bad photo, not a verdict", async () => {
    const { id } = await newRound();
    await expect(checkFound(id, Buffer.from("x"))).rejects.toMatchObject({ code: "bad_photo" });
    expect(vi.mocked(judgeFound)).not.toHaveBeenCalled();
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

  it("the player can see their own photo while hunting, but not what was chosen in it", async () => {
    const { id } = await newRound();
    const round = await getRound(id);
    expect(round?.photoUrl).toBe(`/api/rounds/${id}/image/photo`);
    expect(await getRoundImage(id, "photo")).toBeInstanceOf(Buffer);
    expect(await getRoundImage(id, "reveal")).toBeUndefined();
    expect(round?.reveal).toBeUndefined();
  });
});

describe("saying you saw it", () => {
  it("shows the answer and waits for the player's word before ending the round", async () => {
    const { id } = await newRound();
    const claimed = await claimSeen(id);
    expect(claimed.status).toBe("claimed");
    expect(claimed.reveal?.label).toBe("small brass plaque dated 1919");
    expect(await getRoundImage(id, "reveal")).toBeInstanceOf(Buffer);
    await expect(unlockHint(id)).rejects.toMatchObject({ code: "wrong_state" });
    const found = await settleClaim(id, true);
    expect(found.status).toBe("found");
    expect(found.stats?.selfReported).toBe(true);
    const log = await fs.readFile(path.join(dataDir, "fieldlog.jsonl"), "utf8");
    expect(log).toContain('"event":"claimed_seen"');
    expect(log).toContain('"event":"self_report"');
  });

  it("if it wasn't it, the round ends as revealed", async () => {
    const { id } = await newRound();
    await claimSeen(id);
    const r = await settleClaim(id, false);
    expect(r.status).toBe("revealed");
    expect((await loadRound(id))?.selfReport).toBe("not_it");
  });

  it("only a round waiting for an answer can be settled, once", async () => {
    const { id } = await newRound();
    await expect(settleClaim(id, true)).rejects.toMatchObject({ code: "wrong_state" });
    await claimSeen(id);
    await settleClaim(id, true);
    await expect(settleClaim(id, false)).rejects.toMatchObject({ code: "wrong_state" });
    await expect(claimSeen(id)).rejects.toMatchObject({ code: "wrong_state" });
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
