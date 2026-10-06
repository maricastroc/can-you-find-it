import { describe, expect, it } from "vitest";
import { isLocalHost, rowFor, summarize, toCsv } from "./notes";
import type { Round } from "./types";

const base: Round = {
  id: "a",
  createdAt: "2026-10-06T10:00:00.000Z",
  status: "found",
  model: "gemma4:e4b",
  photo: { width: 4032, height: 3024 },
  target: {
    label: "brass plaque, dated 1919",
    box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    lens: "remember",
    clue: "Someone wanted this place to remember something.",
    hints: { semantic: "s", concrete: "c", spatial: "p" },
    detail: "d",
    evidence: "e",
  },
  hintsUsed: 2,
  attempts: [
    { at: "2026-10-06T10:02:00.000Z", verdict: "not_quite", shows: "", ms: 1, file: "found-1.jpg" },
    { at: "2026-10-06T10:04:00.000Z", verdict: "found", shows: "", ms: 1, file: "found-2.jpg" },
  ],
  feedback: [
    { at: "x", kind: "great_moment" },
    { at: "x", kind: "note", note: "kids pointed at it too" },
  ],
  timings: { lookingMs: 41_500, clueAt: "2026-10-06T10:00:45.000Z", endedAt: "2026-10-06T10:04:00.000Z" },
};

describe("field notes", () => {
  it("summarises a round", () => {
    const r = rowFor(base);
    expect(r).toMatchObject({ lookingSeconds: 42, secondsToEnd: 195, hints: 2, verdicts: ["not_quite", "found"], greatMoment: true, override: false });
    expect(r.notes).toEqual(["kids pointed at it too"]);
  });

  it("counts outcomes and flags", () => {
    const rows = [
      rowFor(base),
      rowFor({ ...base, id: "b", status: "revealed", feedback: [{ at: "x", kind: "target_wrong" }] }),
      rowFor({ ...base, id: "c", status: "none", target: undefined, attempts: [], feedback: [], timings: { lookingMs: 30_000 } }),
      rowFor({ ...base, id: "d", feedback: [{ at: "x", kind: "should_have_matched" }, { at: "x", kind: "should_not_have_matched" }] }),
    ];
    expect(summarize(rows)).toMatchObject({ rounds: 4, played: 3, found: 2, gaveUp: 1, noTarget: 1, badTargets: 1, overrides: 1, falsePositives: 1, greatMoments: 1 });
  });

  it("exports CSV with quoting", () => {
    const csv = toCsv([rowFor(base)]);
    expect(csv.split("\n")[0]).toMatch(/^at,status,label/);
    expect(csv).toContain('"brass plaque, dated 1919"');
    expect(csv).toContain("not_quite → found");
  });

  it("only treats the computer itself as local", () => {
    expect(isLocalHost("localhost:3000")).toBe(true);
    expect(isLocalHost("127.0.0.1:3000")).toBe(true);
    expect(isLocalHost("[::1]:3000")).toBe(true);
    expect(isLocalHost("192.168.0.139:3000")).toBe(false);
    expect(isLocalHost(null)).toBe(false);
  });
});
