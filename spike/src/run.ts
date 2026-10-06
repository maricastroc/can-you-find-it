/**
 * Spike runner: ask a local VLM to pick secret targets in wide photos, turn
 * its boxes into real crops, and run a second, crop-only verification pass.
 *
 *   npx tsx spike/src/run.ts --model gemma4:e4b --strategy single
 *   npx tsx spike/src/run.ts --model gemma4:e4b --strategy propose --images c000,c002
 *   npx tsx spike/src/run.ts --model gemma4:e4b --strategy tiles
 *
 * Output: spike/data/runs/<run>/{<image>.json, crops/, overlays/}
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp, { type Sharp } from "sharp";
import { chat, type ChatResult } from "../../src/lib/hunt/ollama";
import { expand, fromBox2d, fromRegion, tiles, toPixels, type Box } from "../../src/lib/hunt/geometry";
import { extractJson } from "../../src/lib/hunt/json";
import { rejectTarget } from "../../src/lib/hunt/filters";
import {
  GROUND_PROMPT,
  PROPOSE_PROMPT,
  SINGLE_PROMPT,
  SYSTEM,
  TILE_PROMPT,
  VERIFY_PROMPT,
  MCQ_PROMPT,
  mcqSchema,
  GENERIC_DISTRACTORS,
  targetsSchema,
  verifySchema,
} from "./prompts-legacy.ts";

const { values: args } = parseArgs({
  allowNegative: true,
  options: {
    model: { type: "string", default: "gemma4:e4b" },
    verifier: { type: "string" },
    strategy: { type: "string", default: "single" },
    images: { type: "string" },
    run: { type: "string" },
    n: { type: "string", default: "5" },
    think: { type: "boolean", default: false },
    inventory: { type: "boolean", default: false },
    yesno: { type: "boolean", default: true },
    temperature: { type: "string", default: "0.6" },
  },
});

const MODEL = args.model!;
const VERIFIER = args.verifier ?? MODEL;
const STRATEGY = args.strategy as "single" | "propose" | "tiles";
const N = Number(args.n);
const TEMP = Number(args.temperature);
const RUN = args.run ?? `${STRATEGY}${args.inventory ? "+inv" : ""}-${MODEL.replace(/[:/]/g, "_")}${args.think ? "-think" : ""}`;
const ROOT = path.join(process.cwd(), "spike/data");
const OUT = path.join(ROOT, "runs", RUN);
const MODEL_SIDE = 1920; // Ollama reaches Gemma 4's max image budget (~1100 tokens) here.

type RawTarget = {
  label: string;
  locator?: string;
  box_2d?: unknown;
  lens?: string;
  why?: string;
  difficulty?: string;
  clue?: string;
  hint_semantic?: string;
  hint_concrete?: string;
  reveal?: string;
};

type Call = { kind: string; ms: number; promptTokens: number; outputTokens: number; raw: string; thinking?: string };

export type Candidate = RawTarget & {
  idx: number;
  source: string; // "full" or "tile:<n>"
  box?: Box;
  boxProblem?: string;
  boxWarnings?: string[];
  crop?: string;
  verifyCrop?: string;
  verify?: { what_i_see: string; visible: boolean; ms: number } | { error: string };
  rejected?: string;
  mcq?: { options: string[]; correct: string; answer: string; what_i_see: string; pass: boolean; people?: boolean; ms: number } | { error: string };
};

export type ImageResult = {
  image: string;
  width: number;
  height: number;
  model: string;
  verifier: string;
  strategy: string;
  think: boolean;
  calls: Call[];
  candidates: Candidate[];
  /** v4: the candidate the engine actually picked. */
  chosen?: number;
  waitMs?: number;
  seen?: string[];
  error?: string;
};

const toModelJpeg = (img: Sharp, side = MODEL_SIDE) =>
  img.resize(side, side, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer();

function record(calls: Call[], kind: string, r: ChatResult) {
  calls.push({ kind, ms: r.ms, promptTokens: r.promptTokens, outputTokens: r.outputTokens, raw: r.content, thinking: r.thinking });
}

function targetsFrom(raw: string): RawTarget[] {
  const parsed = extractJson(raw) as { targets?: RawTarget[] } | RawTarget[] | undefined;
  const list = Array.isArray(parsed) ? parsed : parsed?.targets;
  return Array.isArray(list) ? list.filter((t) => t && typeof t.label === "string") : [];
}

let lastSeen: string[] | undefined;

async function propose(src: Buffer, calls: Call[]): Promise<Array<RawTarget & { source: string; region?: Box }>> {
  const full = await toModelJpeg(sharp(src));
  if (STRATEGY === "single" || STRATEGY === "propose") {
    const r = await chat({
      model: MODEL,
      system: SYSTEM,
      prompt: STRATEGY === "single" ? SINGLE_PROMPT(N, args.inventory) : PROPOSE_PROMPT(N, args.inventory),
      images: [full],
      format: targetsSchema(N, { box: STRATEGY === "single", locator: STRATEGY === "propose", inventory: args.inventory }),
      think: args.think,
      options: { temperature: TEMP },
    });
    record(calls, "propose", r);
    const seen = (extractJson(r.content) as { seen?: string[] } | undefined)?.seen;
    if (Array.isArray(seen)) lastSeen = seen;
    return targetsFrom(r.content).map((t) => ({ ...t, source: "full" }));
  }
  // tiles: 2x2 with overlap, one target per tile, boxes mapped back.
  const meta = await sharp(src).metadata();
  const out: Array<RawTarget & { source: string; region?: Box }> = [];
  const grid = tiles(2, 2, 0.15);
  for (let i = 0; i < grid.length; i++) {
    const region = grid[i];
    const px = toPixels(region, meta.width!, meta.height!);
    const tile = await sharp(src)
      .extract(px)
      .resize(MODEL_SIDE, MODEL_SIDE, { fit: "inside", withoutEnlargement: false })
      .jpeg({ quality: 85 })
      .toBuffer();
    const r = await chat({
      model: MODEL,
      system: SYSTEM,
      prompt: TILE_PROMPT(1),
      images: [tile],
      format: targetsSchema(1, { box: true }),
      think: args.think,
      options: { temperature: TEMP },
    });
    record(calls, `propose:tile${i}`, r);
    for (const t of targetsFrom(r.content)) out.push({ ...t, source: `tile:${i}`, region });
  }
  return out;
}

async function ground(src: Buffer, t: RawTarget, calls: Call[]): Promise<unknown> {
  const r = await chat({
    model: MODEL,
    prompt: GROUND_PROMPT(t.label, t.locator ?? ""),
    images: [await toModelJpeg(sharp(src))],
    options: { temperature: 0 },
  });
  record(calls, "ground", r);
  const parsed = extractJson(r.content) as unknown;
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return (first as { box_2d?: unknown } | undefined)?.box_2d;
}

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
function shuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function boxSvg(W: number, H: number, boxes: Array<{ box: Box; n: number }>, stroke: number) {
  const parts = boxes.map(({ box, n }) => {
    const x = box.x * W, y = box.y * H, w = box.w * W, h = box.h * H;
    const fs_ = Math.max(18, Math.round(W / 45));
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ffe600" stroke-width="${stroke}"/>` +
      (n >= 0 ? `<rect x="${x}" y="${Math.max(0, y - fs_ * 1.3)}" width="${fs_ * 1.4}" height="${fs_ * 1.3}" fill="#ffe600"/><text x="${x + fs_ * 0.25}" y="${Math.max(fs_, y - fs_ * 0.3)}" font-family="Helvetica" font-weight="bold" font-size="${fs_}" fill="#000">${n}</text>` : "");
  });
  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`);
}

async function processImage(id: string): Promise<ImageResult> {
  const src = await fs.readFile(path.join(ROOT, "images", `${id}.jpg`));
  const meta = await sharp(src).metadata();
  const W = meta.width!, H = meta.height!;
  const calls: Call[] = [];
  const result: ImageResult = { image: id, width: W, height: H, model: MODEL, verifier: VERIFIER, strategy: STRATEGY, think: !!args.think, calls, candidates: [] };

  lastSeen = undefined;
  const proposals = await propose(src, calls);
  result.seen = lastSeen;
  let idx = 0;
  for (const p of proposals) {
    const c: Candidate = { ...p, idx: idx++, source: p.source };
    delete (c as { region?: Box }).region;
    const rawBox = STRATEGY === "propose" ? await ground(src, p, calls) : p.box_2d;
    c.box_2d = rawBox;
    const parsed = fromBox2d(rawBox);
    if (!parsed.ok) {
      c.boxProblem = parsed.problem;
    } else {
      c.box = p.region ? fromRegion(parsed.box, p.region) : parsed.box;
      c.boxWarnings = parsed.warnings;
    }
    result.candidates.push(c);
  }

  // Crops: a context crop (what a reveal would show, with the box drawn) and
  // a tighter crop that the verifier sees without any drawing.
  await fs.mkdir(path.join(OUT, "crops"), { recursive: true });
  for (const c of result.candidates) {
    if (!c.box) continue;
    const aspect = W / H;
    const ctx = expand(c.box, { pad: 0.6, minSide: 0.18, aspect });
    const ctxPx = toPixels(ctx, W, H);
    const inner = {
      x: (c.box.x - ctx.x) / ctx.w, y: (c.box.y - ctx.y) / ctx.h, w: c.box.w / ctx.w, h: c.box.h / ctx.h,
    };
    const ctxBuf = await sharp(src).extract(ctxPx).toBuffer();
    const drawn = await sharp(ctxBuf)
      .composite([{ input: boxSvg(ctxPx.width, ctxPx.height, [{ box: inner, n: -1 }], Math.max(2, Math.round(ctxPx.width / 160))) }])
      .toBuffer();
    c.crop = `crops/${id}-${c.idx}-ctx.jpg`;
    await sharp(drawn).resize(640, 640, { fit: "inside" }).jpeg({ quality: 82 }).toFile(path.join(OUT, c.crop));

    const tight = expand(c.box, { pad: 0.2, minSide: 0.08, aspect });
    const tightBuf = await sharp(src)
      .extract(toPixels(tight, W, H))
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: false })
      .jpeg({ quality: 88 })
      .toBuffer();
    c.verifyCrop = `crops/${id}-${c.idx}-verify.jpg`;
    await fs.writeFile(path.join(OUT, c.verifyCrop), tightBuf);

    c.rejected = rejectTarget(c.label, c.box);
    if (args.yesno) try {
      const r = await chat({
        model: VERIFIER,
        prompt: VERIFY_PROMPT(c.label),
        images: [tightBuf],
        format: verifySchema,
        options: { temperature: 0 },
      });
      record(calls, "verify", r);
      const v = extractJson(r.content) as { what_i_see?: string; visible?: boolean } | undefined;
      c.verify = { what_i_see: String(v?.what_i_see ?? ""), visible: v?.visible === true, ms: r.ms };
    } catch (e) {
      c.verify = { error: String(e) };
    }

    // Multiple choice: the target among other candidates from the same photo
    // (only those whose centre is outside this crop) plus generic distractors.
    const others = result.candidates
      .filter((o) => o !== c && o.box && !inside(center(o.box), tight))
      .map((o) => o.label);
    const pool = [...new Set([...others, ...GENERIC_DISTRACTORS])].filter((l) => l !== c.label).slice(0, 3);
    const options = shuffle([c.label, ...pool], c.idx + 7);
    const correct = c.label;
    try {
      const r = await chat({
        model: VERIFIER,
        prompt: MCQ_PROMPT(options),
        images: [tightBuf],
        format: mcqSchema(options),
        options: { temperature: 0 },
      });
      record(calls, "mcq", r);
      const v = extractJson(r.content) as { what_i_see?: string; answer?: string; person_at_target?: boolean } | undefined;
      const answer = String(v?.answer ?? "none");
      c.mcq = { options, correct, answer, what_i_see: String(v?.what_i_see ?? ""), pass: answer === correct, people: v?.person_at_target, ms: r.ms };
    } catch (e) {
      c.mcq = { error: String(e) };
    }
  }

  // Full overlay with numbered boxes.
  await fs.mkdir(path.join(OUT, "overlays"), { recursive: true });
  const boxes = result.candidates.filter((c) => c.box).map((c) => ({ box: c.box!, n: c.idx }));
  const overlay = await sharp(src).composite([{ input: boxSvg(W, H, boxes, Math.max(3, Math.round(W / 400))) }]).toBuffer();
  await sharp(overlay).resize(1600, 1600, { fit: "inside" }).jpeg({ quality: 80 }).toFile(path.join(OUT, "overlays", `${id}.jpg`));
  return result;
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "images/manifest.json"), "utf8")) as Array<{ id: string }>;
  const ids = args.images ? args.images.split(",") : manifest.map((m) => m.id);
  await fs.mkdir(OUT, { recursive: true });
  for (const id of ids) {
    const file = path.join(OUT, `${id}.json`);
    if (await fs.stat(file).then(() => true, () => false)) {
      console.log(`${id}: cached`);
      continue;
    }
    const t0 = performance.now();
    let res: ImageResult;
    try {
      res = await processImage(id);
    } catch (e) {
      res = { image: id, width: 0, height: 0, model: MODEL, verifier: VERIFIER, strategy: STRATEGY, think: !!args.think, calls: [], candidates: [], error: String(e) };
    }
    await fs.writeFile(file, JSON.stringify(res, null, 2));
    const ok = res.candidates.filter((c) => c.box).length;
    const vis = res.candidates.filter((c) => c.verify && "visible" in c.verify && c.verify.visible).length;
    const mcq = res.candidates.filter((c) => c.mcq && "pass" in c.mcq && c.mcq.pass).length;
    const rej = res.candidates.filter((c) => c.rejected).length;
    console.log(`${id}: ${res.candidates.length} cands, ${ok} boxes, ${rej} rejected, yes/no ${vis}, mcq ${mcq}, ${((performance.now() - t0) / 1000).toFixed(1)}s${res.error ? " ERROR " + res.error : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
