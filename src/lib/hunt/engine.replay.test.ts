import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { findTarget, writeTexts } from "./engine";
import { replayChat, type RecordedCall } from "./replay";
import c030 from "./__fixtures__/round-c030.json";
import c117 from "./__fixtures__/round-c117.json";
import c054 from "./__fixtures__/round-c054.json";

const photo = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#6b705c" } }).jpeg().toBuffer();
const model = "test";

async function run(fixture: { width: number; height: number; calls: RecordedCall[] }, calls = fixture.calls) {
  const replay = replayChat(calls);
  const result = await findTarget(await photo(fixture.width, fixture.height), { model, chat: replay.chat });
  return { result, kinds: replay.log.map((l) => l.kind) };
}

describe("engine replay (recorded Gemma 4 E4B replies)", () => {
  it("botanical path: picks the plant label and frames it as something to read", async () => {
    const { result, kinds } = await run(c030);
    expect(result.candidates[result.chosen!].label).toBe(c030.label);
    expect(result.lens).toBe("read_me");
    expect(result.clue).toBe("It has something to tell you, if you get close enough to read it.");
    expect(kinds).toEqual(["propose", "verify"]);
  });

  it("garden tower: picks the carved coat of arms with the remember line", async () => {
    const { result } = await run(c117);
    expect(result.candidates[result.chosen!].label).toMatch(/coat of arms/i);
    expect(result.lens).toBe("remember");
  });

  it("forest trail: never offers the hiker, frames the plant by where it is", async () => {
    const { result } = await run(c054);
    expect(result.candidates.find((c) => /person/.test(c.label))?.rejected).toBe("person");
    expect(result.lens).toBe("underfoot");
  });

  it("the clue is ready without any writing call", async () => {
    const { kinds } = await run(c117);
    expect(kinds).not.toContain("write");
  });

  it("declines when the proposal is not JSON", async () => {
    const { result, kinds } = await run(c030, [{ kind: "propose", content: "I see a park with trees." }]);
    expect(result.candidates).toEqual([]);
    expect(result.chosen).toBeUndefined();
    expect(kinds).toEqual(["propose"]);
  });

  it("treats an unreadable verification as a failure", async () => {
    const calls = c030.calls.map((c) => (c.kind === "verify" ? { ...c, content: '{"what_i_see": "a sign", "answer": ' } : c));
    const { result, kinds } = await run(c030, calls);
    expect(result.chosen).toBeUndefined();
    expect(kinds.filter((k) => k === "verify")).toHaveLength(2);
  });

  it("never picks a target someone is sitting on or standing at", async () => {
    const calls = c030.calls.map((c) => (c.kind === "verify" ? { ...c, content: c.content.replace(/"person_at_target":\s*false/, '"person_at_target": true') } : c));
    expect(calls.filter((c) => c.kind === "verify").every((c) => c.content.includes('"person_at_target": true'))).toBe(true);
    const { result } = await run(c030, calls);
    expect(result.chosen).toBeUndefined();
  });

  it("drops proposals with impossible boxes before verifying them", async () => {
    const proposal = JSON.stringify({
      targets: [
        { label: "small blue sign on a pole", box_2d: [100, 100, 100, 100], similar_count: 0 },
        { label: "red mailbox", box_2d: "left side", similar_count: 0 },
      ],
    });
    const { result, kinds } = await run(c030, [{ kind: "propose", content: proposal }]);
    expect(result.candidates.map((c) => c.boxProblem)).toEqual(["degenerate", "not_four_numbers"]);
    expect(kinds).toEqual(["propose"]);
  });

  it("caps how much the model may write on every call", async () => {
    const replay = replayChat(c030.calls);
    await findTarget(await photo(c030.width, c030.height), { model, chat: replay.chat });
    expect(replay.log.map((l) => l.input.options?.num_predict)).toEqual([config.maxTokens.propose, config.maxTokens.verify]);
  });

  it("propagates model failures to the caller", async () => {
    const failing = async () => {
      throw new Error("connection refused");
    };
    await expect(findTarget(await photo(800, 600), { model, chat: failing })).rejects.toThrow("connection refused");
  });
});

describe("writing hints (recorded reply)", () => {
  const target = { label: c030.label, box: { x: 0.064, y: 0.557, w: 0.049, h: 0.044 } };

  it("returns the hints and keeps the clue line already shown", async () => {
    const { chat, log } = replayChat(c030.calls.filter((c) => c.kind === "write"));
    const { texts } = await writeTexts(await photo(c030.width, c030.height), target, { model, chat }, "read_me");
    expect(log[0].input.options?.num_predict).toBe(config.maxTokens.write);
    expect(texts?.lens).toBe("read_me");
    expect(texts?.hint_semantic.length).toBeGreaterThan(10);
    expect(texts?.hint_concrete.length).toBeGreaterThan(10);
  });

  it("returns no texts when the writer's reply is broken", async () => {
    const { chat } = replayChat([{ kind: "write", content: "Sorry, I can't." }]);
    const { texts } = await writeTexts(await photo(800, 600), target, { model, chat }, "read_me");
    expect(texts).toBeUndefined();
  });
});
