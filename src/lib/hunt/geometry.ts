/**
 * Bounding-box handling. Gemma 4 emits `box_2d` as [ymin, xmin, ymax, xmax]
 * normalized to a 0–1000 grid. Internally we use unit boxes {x, y, w, h} in
 * [0, 1] with a top-left origin, which are resolution independent.
 */
export type Box = { x: number; y: number; w: number; h: number };

export type BoxProblem = "not_four_numbers" | "degenerate" | "too_large";

export type BoxResult = { ok: true; box: Box; warnings: string[] } | { ok: false; problem: BoxProblem };

const MIN_SIDE = 0.004; // 4 units on the 1000 grid
const MAX_AREA = 0.6; // a "target" covering most of the frame is not a target

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Drop float noise (0.30000000000000004) without losing grid precision. */
const clean = (v: number) => Math.round(v * 1e6) / 1e6;
const EPS = 1e-9;

/** Parse a model-provided box_2d into a clamped unit box. */
export function fromBox2d(raw: unknown): BoxResult {
  if (!Array.isArray(raw) || raw.length !== 4) return { ok: false, problem: "not_four_numbers" };
  const nums = raw.map((v) => (typeof v === "string" ? Number(v.trim()) : v));
  if (!nums.every((v): v is number => typeof v === "number" && Number.isFinite(v))) {
    return { ok: false, problem: "not_four_numbers" };
  }
  const warnings: string[] = [];
  let scale = 1000;
  // Some generations fall back to 0–1 floats. Only treat them as such when
  // reading them on the 1000 grid would make the box degenerate.
  if (nums.every((v) => v >= 0 && v <= 1) && nums.some((v) => v > 0 && v < 1)) {
    scale = 1;
    warnings.push("unit_scale");
  }
  let [y1, x1, y2, x2] = nums.map((v) => v / scale);
  if (y1 > y2) [y1, y2] = [y2, y1];
  if (x1 > x2) [x1, x2] = [x2, x1];
  if ([y1, x1, y2, x2].some((v) => v < 0 || v > 1)) warnings.push("clamped");
  y1 = clamp01(y1);
  y2 = clamp01(y2);
  x1 = clamp01(x1);
  x2 = clamp01(x2);
  const box = { x: clean(x1), y: clean(y1), w: clean(x2 - x1), h: clean(y2 - y1) };
  if (box.w < MIN_SIDE || box.h < MIN_SIDE) return { ok: false, problem: "degenerate" };
  if (box.w * box.h > MAX_AREA) return { ok: false, problem: "too_large" };
  return { ok: true, box, warnings };
}

/** Map a box expressed inside a sub-region (tile) back to full-image units. */
export function fromRegion(inner: Box, region: Box): Box {
  return {
    x: region.x + inner.x * region.w,
    y: region.y + inner.y * region.h,
    w: inner.w * region.w,
    h: inner.h * region.h,
  };
}

/**
 * Grow a box for cropping: `pad` is the fraction of the box size added on each
 * side, `minSide` the minimum crop side as a fraction of the image's short
 * side (so tiny targets still get context). Aspect ratio of the image is
 * needed to make `minSide` square in pixels.
 */
export function expand(box: Box, opts: { pad: number; minSide: number; aspect: number }): Box {
  const { pad, minSide, aspect } = opts; // aspect = width / height
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  // minSide is relative to the short side; convert to each axis' units.
  const minW = aspect >= 1 ? minSide / aspect : minSide;
  const minH = aspect >= 1 ? minSide : minSide * aspect;
  let w = Math.max(box.w * (1 + 2 * pad), minW);
  let h = Math.max(box.h * (1 + 2 * pad), minH);
  w = Math.min(w, 1);
  h = Math.min(h, 1);
  // Shift (rather than shrink) to stay inside the frame.
  const x = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  const y = Math.min(Math.max(cy - h / 2, 0), 1 - h);
  return { x, y, w, h };
}

export function toPixels(box: Box, width: number, height: number) {
  const left = Math.max(0, Math.floor(box.x * width + EPS));
  const top = Math.max(0, Math.floor(box.y * height + EPS));
  const right = Math.min(width, Math.ceil((box.x + box.w) * width - EPS));
  const bottom = Math.min(height, Math.ceil((box.y + box.h) * height - EPS));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Overlapping grid of tiles in unit coordinates. */
export function tiles(cols: number, rows: number, overlap: number): Box[] {
  const out: Box[] = [];
  const w = 1 / cols + overlap;
  const h = 1 / rows + overlap;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.min(Math.max(c / cols - overlap / 2, 0), 1 - w);
      const y = Math.min(Math.max(r / rows - overlap / 2, 0), 1 - h);
      out.push({ x, y, w, h });
    }
  }
  return out;
}
