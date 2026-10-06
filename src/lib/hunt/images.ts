/** Image preparation for rounds: normalisation, reveal crop, pixelated hint. */
import sharp from "sharp";
import { expand, toPixels, type Box } from "./geometry";

export const MAX_PHOTO_SIDE = 4096;

/** Apply EXIF orientation, cap the size, re-encode as JPEG, drop metadata (GPS). */
export async function normalizePhoto(input: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input, { failOn: "error" })
    .rotate()
    .resize(MAX_PHOTO_SIDE, MAX_PHOTO_SIDE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

/** The region the reveal shows: the target with generous context around it. */
export function revealRegion(box: Box, aspect: number): Box {
  return expand(box, { pad: 0.6, minSide: 0.18, aspect });
}

/** Where the target sits inside the reveal crop, in 0–1 units of that crop. */
export function boxWithin(box: Box, region: Box): Box {
  return { x: (box.x - region.x) / region.w, y: (box.y - region.y) / region.h, w: box.w / region.w, h: box.h / region.h };
}

export async function cropRegion(photo: Buffer, region: Box, maxSide: number): Promise<Buffer> {
  const meta = await sharp(photo).metadata();
  return sharp(photo)
    .extract(toPixels(region, meta.width!, meta.height!))
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();
}

/**
 * Last-resort hint: the reveal crop reduced to a coarse mosaic. Enough to
 * recognise a shape and a colour, not enough to read it.
 */
export async function pixelatedHint(photo: Buffer, region: Box): Promise<Buffer> {
  const crop = await cropRegion(photo, region, 1024);
  const meta = await sharp(crop).metadata();
  const aspect = meta.width! / meta.height!;
  const cells = 20;
  const w = aspect >= 1 ? cells : Math.max(1, Math.round(cells * aspect));
  const h = aspect >= 1 ? Math.max(1, Math.round(cells / aspect)) : cells;
  const tiny = await sharp(crop).resize(w, h, { fit: "fill", kernel: "cubic" }).toBuffer();
  return sharp(tiny)
    .resize(w * 48, h * 48, { kernel: "nearest" })
    .jpeg({ quality: 80 })
    .toBuffer();
}
