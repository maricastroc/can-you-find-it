import { describe, expect, it } from "vitest";
import { chooseLens, rank, screen, shuffle, spatialHint, type EngineCandidate } from "./engine";
import { lensFor } from "./prompts";

describe("screen", () => {
  it("parses the box and keeps a unique, pointable target", () => {
    const r = screen({ label: "small green sign with house number 692", box_2d: [520, 65, 564, 116], similar_count: 0 });
    expect(r.box).toBeDefined();
    expect(r.rejected).toBeUndefined();
  });

  it("reports box problems without throwing", () => {
    expect(screen({ label: "x", box_2d: "nope" })).toEqual({ boxProblem: "not_four_numbers" });
  });

  it("rejects non-unique objects", () => {
    expect(screen({ label: "black iron lamp post", box_2d: [470, 812, 735, 842], similar_count: 4 }).rejected).toBe("not_unique");
  });

  it("rejects masses even when the model claims uniqueness", () => {
    expect(screen({ label: "bright orange autumn foliage", box_2d: [100, 100, 300, 300], similar_count: 0 }).rejected).toBe("mass_noun");
  });
});

describe("rank", () => {
  const c = (idx: number, extra: Partial<EngineCandidate> = {}): EngineCandidate => ({
    idx, label: `t${idx}`, box_2d: [0, 0, 10, 10], box: { x: 0, y: 0, w: 0.1, h: 0.1 }, ...extra,
  });

  it("keeps the model's order by default", () => {
    expect(rank([c(0), c(1), c(2)]).map((x) => x.idx)).toEqual([0, 1, 2]);
  });

  it("moves targets with look-alikes back but trusts the model on difficulty", () => {
    const out = rank([c(0, { similar_count: 2 }), c(1, { difficulty: "hard" }), c(2)]);
    expect(out.map((x) => x.idx)).toEqual([1, 2, 0]);
  });

  it("drops rejected and box-less candidates", () => {
    expect(rank([c(0, { rejected: "person" }), c(1, { box: undefined }), c(2)]).map((x) => x.idx)).toEqual([2]);
  });
});

describe("spatialHint", () => {
  it("names the side of the frame", () => {
    expect(spatialHint({ x: 0.05, y: 0.5, w: 0.1, h: 0.1 })).toMatch(/left/);
    expect(spatialHint({ x: 0.8, y: 0.5, w: 0.1, h: 0.1 })).toMatch(/right/);
    expect(spatialHint({ x: 0.45, y: 0.5, w: 0.1, h: 0.1 })).toMatch(/straight ahead/);
  });

  it("asks to look up for things high in the frame", () => {
    expect(spatialHint({ x: 0.45, y: 0.1, w: 0.05, h: 0.1 })).toMatch(/Look up/);
  });

  it("points to the ground for things low in the frame", () => {
    expect(spatialHint({ x: 0.45, y: 0.8, w: 0.1, h: 0.1 })).toMatch(/ground/);
  });

  it("warns when a small mid-frame target is far away", () => {
    expect(spatialHint({ x: 0.45, y: 0.5, w: 0.02, h: 0.03 })).toMatch(/further away/);
  });
});

describe("shuffle", () => {
  it("is deterministic and a permutation", () => {
    const a = shuffle([1, 2, 3, 4], 9);
    expect(shuffle([1, 2, 3, 4], 9)).toEqual(a);
    expect([...a].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("lensFor", () => {
  it.each([
    ["Black ornamental street lamp with a single fixture", "waiting", "after_dark"],
    ["Red and yellow plastic slide structure in the play area", "handmade", "smaller_people"],
    ["Metal swing set support pole structure", "handmade", "smaller_people"],
    ["Small dark green trash receptacle", "plain_sight", "unwanted"],
    ["Dark potted plant near the right doorway", "waiting", "cared_for"],
    ["Clock tower atop the main administrative building", "look_up", "keeps_time"],
    ["Small green sign with house number 692", "plain_sight", "where_you_are"],
    ["Circular metal sewer cover in the pavement", "plain_sight", "underfoot"],
    ["Small, dark plaque with engraved numbers on brick wall", "plain_sight", "remember"],
    ["Small dark informational plaque attached to a tree trunk", "remember", "read_me"],
    ["White sign with black text on a pole", "plain_sight", "read_me"],
    ["Bronze plaque dated 1919 on a wall", "plain_sight", "remember"],
    ["Small green sign with house number 692", "plain_sight", "where_you_are"],
    ["Stone coat of arms carved into the structure", "handmade", "remember"],
    ["Small red and brown playhouse structure", "plain_sight", "smaller_people"],
  ])("%s → rule wins over the model", (label, model, expected) => {
    expect(lensFor(label, model)).toBe(expected);
  });

  it("ignores where the object is when matching rules", () => {
    expect(lensFor("Orange and white striped umbrella near fountain", undefined)).toBeUndefined();
    expect(lensFor("Bench next to the lamp post", undefined)).toBe("waiting");
    expect(lensFor("Red flowers in the foreground of a gate", undefined)).toBeUndefined();
  });

  it("falls back to the model's choice when no rule matches", () => {
    expect(lensFor("patch of moss on the base of the large tree", "nature_taking_back")).toBe("nature_taking_back");
  });

  it("ignores unknown model choices", () => {
    expect(lensFor("odd blue thing", "made_up_lens")).toBeUndefined();
  });
});

describe("chooseLens", () => {
  const mid = { x: 0.4, y: 0.5, w: 0.1, h: 0.1 };

  it("uses a rule for common objects", () => {
    expect(chooseLens("Ornate black lamppost with glowing head", "remember", mid)).toBe("after_dark");
  });

  it("accepts the model's perceptual lens", () => {
    expect(chooseLens("patch of moss on the base of a tree", "nature_taking_back", mid)).toBe("nature_taking_back");
  });

  it("never lets the model claim a category lens without a rule", () => {
    expect(chooseLens("Stone pillar with rounded top flanking the driveway", "remember", mid)).toBe("plain_sight");
  });

  it("falls back to a spatial lens", () => {
    expect(chooseLens("weathered stone urn on a pedestal", "remember", { x: 0.3, y: 0.1, w: 0.05, h: 0.2 })).toBe("look_up");
    expect(chooseLens("round iron cover with a star pattern", undefined, { x: 0.3, y: 0.8, w: 0.1, h: 0.1 })).toBe("underfoot");
  });
});
