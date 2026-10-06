import { describe, expect, it } from "vitest";
import { expand, fromBox2d, fromRegion, iou, tiles, toPixels } from "./geometry";

describe("fromBox2d", () => {
  it("converts [ymin, xmin, ymax, xmax] on the 1000 grid to a unit box", () => {
    const r = fromBox2d([100, 200, 300, 500]);
    expect(r).toEqual({ ok: true, box: { x: 0.2, y: 0.1, w: 0.3, h: 0.2 }, warnings: [] });
  });

  it("accepts numeric strings", () => {
    const r = fromBox2d(["100", " 200", "300 ", "500"]);
    expect(r.ok && r.box).toEqual({ x: 0.2, y: 0.1, w: 0.3, h: 0.2 });
  });

  it("swaps inverted corners", () => {
    const r = fromBox2d([300, 500, 100, 200]);
    expect(r.ok && r.box).toEqual({ x: 0.2, y: 0.1, w: 0.3, h: 0.2 });
  });

  it("clamps out-of-range values and warns", () => {
    const r = fromBox2d([-20, 900, 200, 1080]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.box.x).toBeCloseTo(0.9);
    expect(r.box.w).toBeCloseTo(0.1);
    expect(r.box.y).toBe(0);
    expect(r.warnings).toContain("clamped");
  });

  it("reads 0–1 floats as unit coordinates", () => {
    const r = fromBox2d([0.1, 0.2, 0.3, 0.5]);
    expect(r.ok && r.box.x).toBeCloseTo(0.2);
    expect(r.ok && r.warnings).toContain("unit_scale");
  });

  it("keeps a genuine tiny box at the top-left corner on the 1000 grid", () => {
    // [0, 0, 1, 1] has no fractional values, so it is not unit scale; it is
    // simply too small to be a target.
    expect(fromBox2d([0, 0, 1, 1])).toEqual({ ok: false, problem: "degenerate" });
  });

  it.each([
    [undefined],
    [null],
    ["100,200,300,400"],
    [[100, 200, 300]],
    [[100, 200, 300, 400, 500]],
    [[100, "x", 300, 400]],
    [[100, Number.NaN, 300, 400]],
    [[100, Number.POSITIVE_INFINITY, 300, 400]],
  ])("rejects malformed input %j", (raw) => {
    expect(fromBox2d(raw)).toEqual({ ok: false, problem: "not_four_numbers" });
  });

  it("rejects degenerate boxes", () => {
    expect(fromBox2d([100, 100, 100, 400])).toEqual({ ok: false, problem: "degenerate" });
    expect(fromBox2d([100, 100, 102, 400])).toEqual({ ok: false, problem: "degenerate" });
  });

  it("rejects boxes that cover most of the frame", () => {
    expect(fromBox2d([0, 0, 1000, 1000])).toEqual({ ok: false, problem: "too_large" });
    expect(fromBox2d([0, 0, 800, 800]).ok).toBe(false);
  });
});

describe("fromRegion", () => {
  it("maps a tile-relative box back to the full image", () => {
    const tile = { x: 0.5, y: 0.25, w: 0.5, h: 0.5 };
    expect(fromRegion({ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, tile)).toEqual({ x: 0.75, y: 0.5, w: 0.1, h: 0.1 });
  });
});

describe("expand", () => {
  it("pads around the centre", () => {
    const e = expand({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, { pad: 0.5, minSide: 0, aspect: 1 });
    expect(e.x).toBeCloseTo(0.3);
    expect(e.w).toBeCloseTo(0.4);
  });

  it("enforces a minimum crop size so tiny targets keep context", () => {
    const e = expand({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 }, { pad: 0.2, minSide: 0.1, aspect: 1 });
    expect(e.w).toBeCloseTo(0.1);
    expect(e.h).toBeCloseTo(0.1);
  });

  it("makes the minimum square in pixels for landscape images", () => {
    // 3:2 landscape: 0.1 of the short side is 0.1/1.5 of the width.
    const e = expand({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 }, { pad: 0, minSide: 0.1, aspect: 1.5 });
    expect(e.h).toBeCloseTo(0.1);
    expect(e.w).toBeCloseTo(0.1 / 1.5);
  });

  it("shifts instead of shrinking at the frame edge", () => {
    const e = expand({ x: 0.95, y: 0, w: 0.05, h: 0.05 }, { pad: 1, minSide: 0, aspect: 1 });
    expect(e.x + e.w).toBeLessThanOrEqual(1);
    expect(e.y).toBe(0);
    expect(e.w).toBeCloseTo(0.15);
  });

  it("never exceeds the frame", () => {
    const e = expand({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, { pad: 1, minSide: 0, aspect: 1 });
    expect(e).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe("toPixels", () => {
  it("rounds outward and clamps to the image", () => {
    expect(toPixels({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 1000, 500)).toEqual({ left: 100, top: 100, width: 300, height: 200 });
    expect(toPixels({ x: 0.999, y: 0.999, w: 0.5, h: 0.5 }, 1000, 1000)).toEqual({ left: 999, top: 999, width: 1, height: 1 });
  });

  it("always yields at least one pixel", () => {
    expect(toPixels({ x: 0.5, y: 0.5, w: 0, h: 0 }, 100, 100)).toMatchObject({ width: 1, height: 1 });
  });
});

describe("iou", () => {
  it("is 1 for identical boxes and 0 for disjoint ones", () => {
    const a = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    expect(iou(a, a)).toBeCloseTo(1);
    expect(iou(a, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })).toBe(0);
  });

  it("computes partial overlap", () => {
    expect(iou({ x: 0, y: 0, w: 0.2, h: 0.2 }, { x: 0.1, y: 0, w: 0.2, h: 0.2 })).toBeCloseTo(1 / 3);
  });
});

describe("tiles", () => {
  it("covers the frame with overlapping tiles inside bounds", () => {
    const t = tiles(2, 2, 0.15);
    expect(t).toHaveLength(4);
    for (const b of t) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(b.y + b.h).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(t[0].x).toBe(0);
    expect(t[3].x + t[3].w).toBeCloseTo(1);
  });
});
