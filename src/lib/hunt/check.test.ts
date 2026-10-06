import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { compareWithTarget, namesKind, verdictFrom } from "./check";
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

describe("compareWithTarget (recorded replies)", () => {
  it("accepts the player's close-up of the real target", async () => {
    const { chat, log } = replayChat(pos.calls);
    const r = await compareWithTarget(await img(), await img(800, 1000), pos.label, { model: "test", chat });
    expect(r.verdict).toBe("found");
    expect(log[0].input.images).toHaveLength(2);
  });

  it("rejects a photo of something else", async () => {
    const { chat } = replayChat(neg.calls);
    const r = await compareWithTarget(await img(), await img(), neg.label, { model: "test", chat });
    expect(r.verdict).toBe("not_quite");
    expect(r.shows.length).toBeGreaterThan(0);
  });

  it("treats a malformed reply as not quite", async () => {
    const { chat } = replayChat([{ kind: "compare", content: "The images look similar." }]);
    const r = await compareWithTarget(await img(), await img(), "a sign", { model: "test", chat });
    expect(r.verdict).toBe("not_quite");
  });
});
