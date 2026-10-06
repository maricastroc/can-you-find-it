export type Box = { x: number; y: number; w: number; h: number };

export type BoxProblem = "not_four_numbers" | "degenerate" | "too_large";

export type BoxResult = { ok: true; box: Box; warnings: string[] } | { ok: false; problem: BoxProblem };

const MIN_SIDE = 0.004;
const MAX_AREA = 0.6;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clean = (v: number) => Math.round(v * 1e6) / 1e6;
const EPS = 1e-9;

export function fromBox2d(raw: unknown): BoxResult {
  if (!Array.isArray(raw) || raw.length !== 4) return { ok: false, problem: "not_four_numbers" };
  const nums = raw.map((v) => (typeof v === "string" ? Number(v.trim()) : v));
  if (!nums.every((v): v is number => typeof v === "number" && Number.isFinite(v))) {
    return { ok: false, problem: "not_four_numbers" };
  }
  const warnings: string[] = [];
  let scale = 1000;
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

export function fromRegion(inner: Box, region: Box): Box {
  return {
    x: region.x + inner.x * region.w,
    y: region.y + inner.y * region.h,
    w: inner.w * region.w,
    h: inner.h * region.h,
  };
}

export function expand(box: Box, opts: { pad: number; minSide: number; aspect: number }): Box {
  const { pad, minSide, aspect } = opts;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const minW = aspect >= 1 ? minSide / aspect : minSide;
  const minH = aspect >= 1 ? minSide : minSide * aspect;
  let w = Math.max(box.w * (1 + 2 * pad), minW);
  let h = Math.max(box.h * (1 + 2 * pad), minH);
  w = Math.min(w, 1);
  h = Math.min(h, 1);
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
