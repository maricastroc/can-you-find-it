import sharp from "sharp";
import { expand, toPixels, type Box } from "./geometry";

export const MAX_PHOTO_SIDE = 4096;

export async function normalizePhoto(input: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input, { failOn: "error" })
    .rotate()
    .resize(MAX_PHOTO_SIDE, MAX_PHOTO_SIDE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

export function revealRegion(box: Box, aspect: number): Box {
  return expand(box, { pad: 0.6, minSide: 0.18, aspect });
}

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

export function areaRegion(box: Box, aspect: number, seed: string): Box {
  const area = expand(box, { pad: 1, minSide: 0.45, aspect });
  const n = Number.parseInt(seed.slice(0, 8), 16) || 0;
  const place = (start: number, size: number, span: number, t: number) => {
    const lo = Math.max(start + size - span, 0);
    const hi = Math.min(start, 1 - span);
    return lo <= hi ? lo + (hi - lo) * t : Math.min(Math.max(start + size / 2 - span / 2, 0), 1 - span);
  };
  return {
    x: place(box.x, box.w, area.w, 0.15 + 0.7 * ((n & 0xffff) / 0xffff)),
    y: place(box.y, box.h, area.h, 0.15 + 0.7 * (((n >>> 16) & 0xffff) / 0xffff)),
    w: area.w,
    h: area.h,
  };
}

export async function areaHint(photo: Buffer, region: Box): Promise<Buffer> {
  const { data, info } = await sharp(photo)
    .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const { left, top, width, height } = toPixels(region, W, H);
  const shade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<path fill="#000" fill-opacity="0.72" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M${left} ${top}H${left + width}V${top + height}H${left}Z"/>` +
      `<rect x="${left + 1.5}" y="${top + 1.5}" width="${Math.max(0, width - 3)}" height="${Math.max(0, height - 3)}" fill="none" stroke="#efeadf" stroke-width="3"/>` +
      `</svg>`,
  );
  return sharp(data).composite([{ input: shade }]).jpeg({ quality: 82 }).toBuffer();
}
