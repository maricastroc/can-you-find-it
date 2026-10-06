import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { findTarget, spatialHint, writeTexts } from "../../src/lib/hunt/engine";
import { expand, toPixels, type Box } from "../../src/lib/hunt/geometry";
import type { Candidate, ImageResult } from "./run.ts";

const { values: args } = parseArgs({
  options: {
    model: { type: "string", default: "gemma4:e4b" },
    images: { type: "string" },
    run: { type: "string" },
    n: { type: "string", default: "2" },
    all: { type: "boolean", default: false },
    side: { type: "string" },
    "skip-write": { type: "boolean", default: false },
  },
});
const MODEL = args.model!;
const RUN = args.run ?? `v4-${MODEL.replace(/[:/]/g, "_")}`;
const ROOT = path.join(process.cwd(), "spike/data");
const OUT = path.join(ROOT, "runs", RUN);

function boxSvg(W: number, H: number, box: Box, stroke: number) {
  return Buffer.from(`<svg width="${W}" height="${H}"><rect x="${box.x * W}" y="${box.y * H}" width="${box.w * W}" height="${box.h * H}" fill="none" stroke="#ffe600" stroke-width="${stroke}"/></svg>`);
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "images/manifest.json"), "utf8")) as Array<{ id: string }>;
  const ids = args.images ? args.images.split(",") : manifest.map((m) => m.id);
  await fs.mkdir(path.join(OUT, "crops"), { recursive: true });
  await fs.mkdir(path.join(OUT, "overlays"), { recursive: true });
  for (const id of ids) {
    const file = path.join(OUT, `${id}.json`);
    if (await fs.stat(file).then(() => true, () => false)) continue;
    const src = await fs.readFile(path.join(ROOT, "images", `${id}.jpg`));
    const meta = await sharp(src).metadata();
    const W = meta.width!, H = meta.height!;
    const t0 = performance.now();
    const res = await findTarget(src, {
      model: MODEL,
      candidates: Number(args.n),
      verifyAll: args.all,
      modelSide: args.side ? Number(args.side) : undefined,
    });
    const chosenCandidate = res.candidates.find((c) => c.idx === res.chosen);
    const written =
      !args["skip-write"] && chosenCandidate && res.lens ? await writeTexts(src, chosenCandidate, { model: MODEL }, res.lens) : undefined;
    const texts = written?.texts;
    const candidates: Candidate[] = [];
    for (const c of res.candidates) {
      const out: Candidate = {
        idx: c.idx, source: "full", label: c.label, box_2d: c.box_2d, box: c.box, boxProblem: c.boxProblem, rejected: c.rejected,
        difficulty: c.difficulty, lens: c.similar_count !== undefined ? `similar:${c.similar_count}` : undefined,
      };
      if (c.verify) out.mcq = { options: c.verify.options, correct: c.label, answer: c.verify.answer, what_i_see: c.verify.what_i_see, people: c.verify.personAtTarget, pass: c.verify.pass, ms: 0 };
      if (c.idx === res.chosen && texts) {
        Object.assign(out, { clue: texts.clue, hint_semantic: texts.hint_semantic, hint_concrete: texts.hint_concrete, reveal: `${texts.detail} (evidence: ${texts.evidence})`, lens: texts.lens });
        (out as Candidate & { spatial?: string }).spatial = spatialHint(c.box!);
      }
      if (c.box) {
        const ctx = expand(c.box, { pad: 0.6, minSide: 0.18, aspect: W / H });
        const px = toPixels(ctx, W, H);
        const inner = { x: (c.box.x - ctx.x) / ctx.w, y: (c.box.y - ctx.y) / ctx.h, w: c.box.w / ctx.w, h: c.box.h / ctx.h };
        const buf = await sharp(src).extract(px).toBuffer();
        const drawn = await sharp(buf).composite([{ input: boxSvg(px.width, px.height, inner, Math.max(2, Math.round(px.width / 160))) }]).toBuffer();
        out.crop = `crops/${id}-${c.idx}-ctx.jpg`;
        await sharp(drawn).resize(640, 640, { fit: "inside" }).jpeg({ quality: 82 }).toFile(path.join(OUT, out.crop));
      }
      candidates.push(out);
    }
    const boxes = res.candidates.filter((c) => c.box);
    const svg = `<svg width="${W}" height="${H}">${boxes.map((c) => `<rect x="${c.box!.x * W}" y="${c.box!.y * H}" width="${c.box!.w * W}" height="${c.box!.h * H}" fill="none" stroke="${c.idx === res.chosen ? "#00ff88" : "#ffe600"}" stroke-width="${Math.round(W / 300)}"/><text x="${c.box!.x * W}" y="${c.box!.y * H - 8}" font-size="${Math.round(W / 40)}" fill="#ffe600" font-family="Helvetica" font-weight="bold">${c.idx}</text>`).join("")}</svg>`;
    const overlay = await sharp(src).composite([{ input: Buffer.from(svg) }]).toBuffer();
    await sharp(overlay).resize(1600, 1600, { fit: "inside" }).jpeg({ quality: 80 }).toFile(path.join(OUT, "overlays", `${id}.jpg`));
    const result: ImageResult & { chosen?: number; waitMs: number } = {
      image: id, width: W, height: H, model: MODEL, verifier: MODEL, strategy: "v4", think: false,
      calls: [...res.steps, ...(written ? [written.step] : [])].map((s) => ({ ...s, kind: s.kind.startsWith("verify") ? "mcq" : s.kind })),
      candidates, chosen: res.chosen, waitMs: res.waitMs,
    };
    await fs.writeFile(file, JSON.stringify(result, null, 2));
    const ch = res.candidates.find((c) => c.idx === res.chosen);
    console.log(`${id}: chosen=${res.chosen ?? "none"} wait=${(res.waitMs / 1000).toFixed(1)}s total=${((performance.now() - t0) / 1000).toFixed(1)}s ${ch ? JSON.stringify(ch.label) + " → " + JSON.stringify(res.clue) : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
