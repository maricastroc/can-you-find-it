import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { compareWithTarget, judgeFound, namesKind, spotOptions, verdictFrom } from "./check";
import { config } from "./config";
import { replayChat } from "./replay";
import pos from "./__fixtures__/check-c030-pos.json";
import neg from "./__fixtures__/check-c030-neg.json";

const img = (w = 300, h = 200) => sharp({ create: { width: w, height: h, channels: 3, background: "#456" } }).jpeg().toBuffer();

describe("verdictFrom", () => {
  it("maps same object to found", () => {
    expect(verdictFrom({ same_kind: true, same_object: true, image2_shows: "it", target_details: ["a"] })).toMatchObject({ verdict: "found", shows: "it", details: ["a"] });
  });

  it("maps same kind only to almost", () => {
    expect(verdictFrom({ same_kind: true, same_object: false }).verdict).toBe("almost");
  });

  it("maps neither to not quite", () => {
    expect(verdictFrom({ same_kind: false, same_object: false }).verdict).toBe("not_quite");
  });

  it.each([[undefined], [null], ["yes"], [{ same_object: "true" }], [{ same_object: 1 }]])("never reads %j as found", (raw) => {
    expect(verdictFrom(raw).verdict).not.toBe("found");
  });

  it("only says ALMOST when the player's photo shows the same kind of thing by name", () => {
    const raw = { same_kind: true, same_object: false };
    expect(verdictFrom({ ...raw, image2_shows: "A close-up of a dark wooden bench." }, "long white bench with black iron legs").verdict).toBe("almost");
    expect(verdictFrom({ ...raw, image2_shows: "A striped marker among green foliage." }, "Large, textured, brown tree trunk").verdict).toBe("not_quite");
  });

  it("matches plurals and punctuation when naming the kind", () => {
    expect(namesKind("Two benches, side by side.", "green bench")).toBe(true);
    expect(namesKind("A lamp-post (iron).", "black iron lamp post")).toBe(true);
    expect(namesKind("a fountain", "bronze statue of a man")).toBe(false);
  });

  it("drops non-string details", () => {
    expect(verdictFrom({ target_details: ["ok", 3, null] }).details).toEqual(["ok"]);
  });
});

describe("judgeFound (recorded Gemma replies)", () => {
  const others = ["small yellow flowers in middle distance"];

  it("accepts the player's close-up of the real target", async () => {
    const { chat, log } = replayChat(pos.calls);
    const r = await judgeFound(await img(), await img(800, 1000), pos.label, others, { model: "test", chat });
    expect(r.verdict).toBe("found");
    expect(log.map((l) => l.kind)).toEqual(["spot", "match", "compare"]);
    expect(log[2].input.images).toHaveLength(2);
    expect(log[2].input.options?.num_predict).toBe(config.maxTokens.compare);
  });

  it("rejects a photo of something else after the first look, without comparing", async () => {
    const { chat, log } = replayChat(neg.calls);
    const r = await judgeFound(await img(), await img(), neg.label, others, { model: "test", chat });
    expect(r.verdict).toBe("not_quite");
    expect(r.shows).toBe("Brown dirt path next to green foliage");
    expect(log.map((l) => l.kind)).toEqual(["spot", "match"]);
  });
});

describe("compareWithTarget", () => {
  it("treats a malformed reply as not quite", async () => {
    const { chat } = replayChat([{ kind: "compare", content: "The images look similar." }]);
    const r = await compareWithTarget(await img(), await img(), "a sign", { model: "test", chat });
    expect(r.verdict).toBe("not_quite");
  });
});

describe("spotOptions", () => {
  const label = "Black pedestal fan with metal grille";

  it("offers the target once among a few distractors", () => {
    const options = spotOptions(label, ["Framed picture of a woman's portrait", "Yellow and black zebra patterned throw blanket"]);
    expect(options.filter((o) => o === label)).toHaveLength(1);
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options.length).toBeLessThanOrEqual(5);
    expect(options).toContain("Framed picture of a woman's portrait");
  });

  it("never offers another thing of the same kind, which would split a correct answer", () => {
    expect(spotOptions(label, ["small white desk fan"])).not.toContain("small white desk fan");
  });

  it("leaves out where the target is, so a path photo can't match a sign just for being near a tree", () => {
    const options = spotOptions("small dark informational sign near tree base", []);
    expect(options).toContain("small dark informational sign");
    expect(options.some((o) => o.includes("tree"))).toBe(false);
  });

  it("is the same every time for the same target", () => {
    expect(spotOptions(label, ["a lamp"])).toEqual(spotOptions(label, ["a lamp"]));
  });
});

describe("judgeFound", () => {
  const label = "Black pedestal fan with metal grille";
  const say = (kind: string, content: object) => ({ kind, content: JSON.stringify(content) });

  it("looks at the player's photo first without knowing what the target is", async () => {
    const { chat, log } = replayChat([say("spot", { main_thing: "laptop screen with text" }), say("match", { answer: "none" })]);
    await judgeFound(await img(), await img(800, 1000), label, [], { model: "test", chat });
    expect(log[0].kind).toBe("spot");
    expect(log[0].input.images).toHaveLength(1);
    expect(log[0].input.prompt).not.toContain("fan");
    expect(log[1].kind).toBe("match");
    expect(log[1].input.images).toBeUndefined();
    expect(log[1].input.prompt).toContain("laptop screen with text");
  });

  it("an unrelated photo is not quite, without any comparison", async () => {
    const { chat, log } = replayChat([say("spot", { main_thing: "laptop screen with text" }), say("match", { answer: "none" })]);
    const r = await judgeFound(await img(), await img(), label, [], { model: "test", chat });
    expect(r.verdict).toBe("not_quite");
    expect(r.shows).toBe("laptop screen with text");
    expect(log.map((l) => l.kind)).toEqual(["spot", "match"]);
  });

  it("a comparison that would say yes cannot overrule a first look that saw something else", async () => {
    const { chat, log } = replayChat([
      say("spot", { main_thing: "a small brown round object" }),
      say("match", { answer: "a red fire hydrant" }),
      say("compare", { target_details: ["black"], image2_shows: label, same_kind: true, same_object: true }),
    ]);
    const r = await judgeFound(await img(), await img(), label, [], { model: "test", chat });
    expect(r.verdict).toBe("not_quite");
    expect(log.map((l) => l.kind)).not.toContain("compare");
  });

  it("the right kind of thing goes on to the detailed comparison", async () => {
    const { chat, log } = replayChat([
      say("spot", { main_thing: "black standing fan" }),
      say("match", { answer: label }),
      say("compare", { target_details: ["black grille"], image2_shows: "a black pedestal fan", same_kind: true, same_object: true }),
    ]);
    const r = await judgeFound(await img(), await img(), label, [], { model: "test", chat });
    expect(r.verdict).toBe("found");
    expect(r.shows).toBe("black standing fan");
    expect(log.map((l) => l.kind)).toEqual(["spot", "match", "compare"]);
  });

  it("another fan is only almost", async () => {
    const { chat } = replayChat([
      say("spot", { main_thing: "white desk fan" }),
      say("match", { answer: label }),
      say("compare", { target_details: ["black grille"], image2_shows: "a white desk fan", same_kind: true, same_object: false }),
    ]);
    const r = await judgeFound(await img(), await img(), label, [], { model: "test", chat });
    expect(r.verdict).toBe("almost");
  });

  it("a photo the model can't describe is not quite", async () => {
    const { chat, log } = replayChat([say("spot", { main_thing: "" })]);
    const r = await judgeFound(await img(), await img(), label, [], { model: "test", chat });
    expect(r.verdict).toBe("not_quite");
    expect(log).toHaveLength(1);
  });
});
