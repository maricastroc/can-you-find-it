/**
 * The engine replayed against real Gemma 4 E4B replies recorded by
 * scripts/record-fixtures.mts — deterministic, no model needed.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { findTarget } from "./engine";
import { replayChat, type RecordedCall } from "./replay";
import c030 from "./__fixtures__/round-c030.json";
import c117 from "./__fixtures__/round-c117.json";
import c054 from "./__fixtures__/round-c054.json";

/** A verification reply that matches nothing, for candidates not in the recording. */
const NONE: RecordedCall = { kind: "verify", content: '{"what_i_see": "leaves", "answer": "none", "person_at_target": false}' };

const photo = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#6b705c" } }).jpeg().toBuffer();
const model = "test";

async function run(fixture: { width: number; height: number; calls: RecordedCall[] }, calls = fixture.calls) {
  const replay = replayChat(calls);
  const result = await findTarget(await photo(fixture.width, fixture.height), { model, chat: replay.chat });
  return { result, kinds: replay.log.map((l) => l.kind) };
}

describe("engine replay (recorded model replies)", () => {
  it("botanical path: picks the plant label and frames it as something to read", async () => {
    const { result, kinds } = await run(c030);
    const chosen = result.candidates.find((c) => c.idx === result.chosen)!;
    expect(chosen.label).toBe(c030.label);
    expect(result.texts?.lens).toBe("read_me");
    expect(result.texts?.clue).toBe("It has something to tell you, if you get close enough to read it.");
    expect(result.texts?.hint_semantic.length).toBeGreaterThan(10);
    expect(kinds[0]).toBe("propose");
    expect(kinds.at(-1)).toBe("write");
  });

  it("garden tower: picks the carved crest and uses the remember line", async () => {
    const { result } = await run(c117);
    expect(result.candidates[result.chosen!].label).toMatch(/crest|coat of arms/i);
    expect(result.texts?.lens).toBe("remember");
  });

  it("forest trail: masses are filtered and nothing else verifies, so it declines", async () => {
    const { result, kinds } = await run(c054);
    expect(result.chosen).toBeUndefined();
    expect(result.texts).toBeUndefined();
    expect(result.candidates.find((c) => /bushes/.test(c.label))?.rejected).toBe("mass_noun");
    expect(kinds).not.toContain("write");
  });

  it("stops verifying at the first candidate that passes", async () => {
    const { kinds } = await run(c030);
    expect(kinds.filter((k) => k === "verify").length).toBeLessThanOrEqual(3);
  });

  it("declines when the proposal is not JSON", async () => {
    const { result, kinds } = await run(c030, [{ kind: "propose", content: "I see a park with trees." }]);
    expect(result.candidates).toEqual([]);
    expect(result.chosen).toBeUndefined();
    expect(kinds).toEqual(["propose"]);
  });

  it("treats an unreadable verification as a failure", async () => {
    const calls = c030.calls.map((c) => (c.kind === "verify" ? { ...c, content: '{"what_i_see": "a sign", "answer": ' } : c));
    const { result, kinds } = await run(c030, [...calls, NONE, NONE]);
    expect(result.chosen).toBeUndefined();
    expect(kinds.filter((k) => k === "verify")).toHaveLength(3);
  });

  it("never picks a target someone is sitting on or standing at", async () => {
    const calls = c030.calls.map((c) => (c.kind === "verify" ? { ...c, content: c.content.replace(/"person_at_target":\s*false/, '"person_at_target": true') } : c));
    expect(calls.some((c) => c.content.includes('"person_at_target": true'))).toBe(true);
    const { result } = await run(c030, [...calls, NONE, NONE]);
    expect(result.chosen).toBeUndefined();
  });

  it("keeps the pick but returns no texts when the writer's reply is broken", async () => {
    const calls = c030.calls.map((c) => (c.kind === "write" ? { ...c, content: "Sorry, I can't." } : c));
    const { result } = await run(c030, calls);
    expect(result.chosen).toBeDefined();
    expect(result.texts).toBeUndefined();
  });

  it("drops proposals with impossible boxes before verifying them", async () => {
    const proposal = JSON.stringify({
      targets: [
        { label: "small blue sign on a pole", box_2d: [100, 100, 100, 100], similar_count: 0, difficulty: "easy" },
        { label: "red mailbox", box_2d: "left side", similar_count: 0, difficulty: "easy" },
      ],
    });
    const { result, kinds } = await run(c030, [{ kind: "propose", content: proposal }]);
    expect(result.candidates.map((c) => c.boxProblem)).toEqual(["degenerate", "not_four_numbers"]);
    expect(kinds).toEqual(["propose"]);
  });

  it("propagates model failures to the caller", async () => {
    const failing = async () => {
      throw new Error("connection refused");
    };
    await expect(findTarget(await photo(800, 600), { model, chat: failing })).rejects.toThrow("connection refused");
  });
});
