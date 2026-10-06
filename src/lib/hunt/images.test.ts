import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { boxWithin, cropRegion, MAX_PHOTO_SIDE, normalizePhoto, pixelatedHint, revealRegion } from "./images";
import { cropFor } from "./engine";

/** A photo with a bright red square at a known place on a grey background. */
async function photoWithSquare(w: number, h: number, sq: { x: number; y: number; size: number }) {
  const square = await sharp({ create: { width: sq.size, height: sq.size, channels: 3, background: "#ff0000" } }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: "#808080" } })
    .composite([{ input: square, left: sq.x, top: sq.y }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function redFraction(img: Buffer, region?: { x: number; y: number; w: number; h: number }) {
  const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  let total = 0;
  const x0 = Math.floor((region?.x ?? 0) * info.width);
  const y0 = Math.floor((region?.y ?? 0) * info.height);
  const x1 = Math.ceil(((region?.x ?? 0) + (region?.w ?? 1)) * info.width);
  const y1 = Math.ceil(((region?.y ?? 0) + (region?.h ?? 1)) * info.height);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * info.width + x) * info.channels;
      total++;
      if (data[i] > 200 && data[i + 1] < 80 && data[i + 2] < 80) red++;
    }
  return red / total;
}

describe("normalizePhoto", () => {
  it("caps the long side and keeps the aspect ratio", async () => {
    const big = await sharp({ create: { width: 6000, height: 3000, channels: 3, background: "#123" } }).jpeg().toBuffer();
    const r = await normalizePhoto(big);
    expect(Math.max(r.width, r.height)).toBe(MAX_PHOTO_SIDE);
    expect(r.width / r.height).toBeCloseTo(2, 2);
  });

  it("applies EXIF orientation and strips metadata such as GPS", async () => {
    const rotated = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#123" } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD3: { GPSLatitudeRef: "N", GPSLatitude: "38/1 43/1 0/1" } } })
      .toBuffer();
    const r = await normalizePhoto(rotated);
    expect([r.width, r.height]).toEqual([200, 400]);
    const meta = await sharp(r.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("rejects bytes that are not an image", async () => {
    await expect(normalizePhoto(Buffer.from("not a photo"))).rejects.toThrow();
  });
});

describe("crops follow the box", () => {
  const W = 2000;
  const H = 1500;
  const sq = { x: 1400, y: 300, size: 100 };
  const box = { x: sq.x / W, y: sq.y / H, w: sq.size / W, h: sq.size / H };

  it("the verification crop is centred on the target", async () => {
    const photo = await photoWithSquare(W, H, sq);
    const { buffer } = await cropFor(photo, box, "verify");
    expect(await redFraction(buffer, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 })).toBeGreaterThan(0.9);
    expect(await redFraction(buffer, { x: 0, y: 0, w: 0.1, h: 0.1 })).toBe(0);
  });

  it("the reveal box points at the target inside the reveal crop", async () => {
    const photo = await photoWithSquare(W, H, sq);
    const region = revealRegion(box, W / H);
    const crop = await cropRegion(photo, region, 1400);
    const inner = boxWithin(box, region);
    expect(await redFraction(crop, { x: inner.x + inner.w * 0.2, y: inner.y + inner.h * 0.2, w: inner.w * 0.6, h: inner.h * 0.6 })).toBeGreaterThan(0.95);
    expect(inner.x).toBeGreaterThan(0);
    expect(inner.x + inner.w).toBeLessThan(1);
  });

  it("keeps targets at the frame edge inside the crop", async () => {
    const edge = { x: 1940, y: 1440, size: 60 };
    const photo = await photoWithSquare(W, H, edge);
    const b = { x: edge.x / W, y: edge.y / H, w: edge.size / W, h: edge.size / H };
    const region = revealRegion(b, W / H);
    expect(region.x + region.w).toBeLessThanOrEqual(1);
    expect(region.y + region.h).toBeLessThanOrEqual(1);
    const inner = boxWithin(b, region);
    const crop = await cropRegion(photo, region, 1400);
    expect(await redFraction(crop, { x: inner.x, y: inner.y, w: inner.w * 0.9, h: inner.h * 0.9 })).toBeGreaterThan(0.8);
  });

  it("the hint is a coarse mosaic that still carries the target's colour", async () => {
    const photo = await photoWithSquare(W, H, sq);
    const hint = await pixelatedHint(photo, revealRegion(box, W / H));
    const meta = await sharp(hint).metadata();
    expect(meta.width! % 48).toBe(0);
    // Somewhere in the mosaic there is a reddish cell, but no fine detail survives.
    const { data, info } = await sharp(hint).raw().toBuffer({ resolveWithObject: true });
    let reddish = false;
    for (let i = 0; i < data.length; i += info.channels) if (data[i] > data[i + 1] + 40) reddish = true;
    expect(reddish).toBe(true);
  });
});
