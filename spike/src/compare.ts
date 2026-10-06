import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { chat } from "../../src/lib/hunt/ollama";
import { extractJson } from "../../src/lib/hunt/json";
import { COMPARE_PROMPT, COMPARE2_PROMPT, compare2Schema, compareSchema } from "./prompts-legacy.ts";
import { compareWithTarget, judgeFound, verdictFrom } from "../../src/lib/hunt/check";
import { toPixels, type Box } from "../../src/lib/hunt/geometry";

type Ref = { file: string; box: Box; aug?: boolean };
type Pair = { id: string; kind: "positive" | "positive_aug" | "hard_negative" | "negative"; label: string; target: Ref; found: Ref };

const B = (x1: number, x2: number, y1: number, y2: number): Box => ({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
const I = (id: string) => `images/${id}.jpg`;
const P = (id: string) => `pairs/${id}.jpg`;

const monument = { file: P("c063"), box: B(0.385, 0.455, 0.57, 0.76) };
const obelisk = { file: I("c012"), box: B(0.07, 0.32, 0.17, 0.8) };
const rock = { file: I("c073"), box: B(0.38, 0.76, 0.58, 0.92) };
const hanok = { file: P("c100"), box: B(0.18, 0.36, 0.62, 0.88) };
const fountain = { file: I("c009"), box: B(0.58, 0.78, 0.58, 0.8) };
const bench = { file: P("c039"), box: B(0.19, 0.59, 0.64, 0.91) };
const sign58 = { file: P("c099"), box: B(0.025, 0.075, 0.53, 0.61) };
const sign692 = { file: I("c028"), box: B(0.065, 0.116, 0.52, 0.564) };
const lampFlowers = { file: P("c050"), box: B(0.07, 0.15, 0.25, 0.6) };
const lamp = { file: I("c000"), box: B(0.812, 0.842, 0.47, 0.735) };

export const PAIRS: Pair[] = [
  { id: "P1-monument", kind: "positive", label: "bronze statue of a man on a tall dark stone pedestal", target: monument, found: { file: P("c064"), box: B(0.15, 0.75, 0, 0.72) } },
  { id: "P2-obelisk", kind: "positive", label: "tall stone obelisk rising from a fountain with white marble sculptures", target: obelisk, found: { file: P("c014"), box: B(0.18, 0.48, 0.2, 0.9) } },
  { id: "P3-rock", kind: "positive", label: "large flat grey rock jutting into the pond", target: rock, found: { file: P("c075"), box: B(0.45, 1, 0.55, 0.92) } },
  { id: "P4-hanok", kind: "positive", label: "grey patterned brick wall with a small wooden lattice window and wooden doors", target: hanok, found: { file: P("c103"), box: B(0.18, 0.68, 0.5, 0.85) } },
  { id: "P5-loosestrife", kind: "positive", label: "tall bush of purple loosestrife flowers at the water's edge", target: { file: I("c073"), box: B(0.02, 0.5, 0, 0.55) }, found: { file: P("c075"), box: B(0.05, 0.75, 0.05, 0.6) } },
  { id: "A1-fountain", kind: "positive_aug", label: "fountain with water jets in a round stone basin", target: fountain, found: { ...fountain, aug: true } },
  { id: "A2-bench", kind: "positive_aug", label: "long white wooden bench with black iron legs", target: bench, found: { ...bench, aug: true } },
  { id: "A3-sign58", kind: "positive_aug", label: "small blue house-number plate with the number 58", target: sign58, found: { ...sign58, aug: true } },
  { id: "A4-sign692", kind: "positive_aug", label: "small green sign with house number 692", target: sign692, found: { ...sign692, aug: true } },
  { id: "A5-lamp", kind: "positive_aug", label: "black iron lamp post with a lantern on top", target: lamp, found: { ...lamp, aug: true } },
  { id: "N1-monument-vs-obelisk", kind: "hard_negative", label: "bronze statue of a man on a tall dark stone pedestal", target: monument, found: obelisk },
  { id: "N2-obelisk-vs-fountain", kind: "hard_negative", label: "tall stone obelisk rising from a fountain with white marble sculptures", target: obelisk, found: fountain },
  { id: "N3-hanok-vs-hanok", kind: "hard_negative", label: "grey patterned brick wall with a small wooden lattice window and wooden doors", target: hanok, found: { file: P("c099"), box: B(0, 0.32, 0.38, 0.95) } },
  { id: "N4-bench-vs-bench", kind: "hard_negative", label: "long white wooden bench with black iron legs", target: bench, found: { file: I("c000"), box: B(0.41, 0.535, 0.755, 0.915) } },
  { id: "N5-sign-vs-sign", kind: "hard_negative", label: "small blue house-number plate with the number 58", target: sign58, found: sign692 },
  { id: "N6-bridge-vs-bridge", kind: "hard_negative", label: "low concrete road bridge over the river", target: { file: P("c049"), box: B(0.35, 0.7, 0.45, 0.56) }, found: { file: P("c050"), box: B(0.28, 0.82, 0.38, 0.6) } },
  { id: "N7-lamp-vs-lamp", kind: "hard_negative", label: "black iron lamp post with a lantern on top", target: lamp, found: lampFlowers },
  { id: "U1-fountain-vs-bench", kind: "negative", label: "fountain with water jets in a round stone basin", target: fountain, found: bench },
  { id: "U2-monument-vs-sign", kind: "negative", label: "bronze statue of a man on a tall dark stone pedestal", target: monument, found: sign58 },
  { id: "U3-lamp-vs-bench", kind: "negative", label: "black iron lamp post with a lantern on top", target: lamp, found: bench },
  { id: "U4-sign-vs-monument", kind: "negative", label: "small green sign with house number 692", target: sign692, found: monument },
  { id: "U5-rock-vs-lamp", kind: "negative", label: "large flat grey rock jutting into the pond", target: rock, found: lamp },
  { id: "U6-hanok-vs-fountain", kind: "negative", label: "grey patterned brick wall with a small wooden lattice window and wooden doors", target: hanok, found: fountain },
  { id: "U7-bench-vs-obelisk", kind: "negative", label: "long white wooden bench with black iron legs", target: bench, found: obelisk },
];

const ROOT = path.join(process.cwd(), "spike/data");

async function render(ref: Ref, side: number): Promise<Buffer> {
  const src = await fs.readFile(path.join(ROOT, ref.file));
  const m = await sharp(src).metadata();
  let box = ref.box;
  if (ref.aug) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const w = Math.min(1, box.w * 0.85), h = Math.min(1, box.h * 0.85);
    box = { x: Math.max(0, cx - w / 2 + box.w * 0.04), y: Math.max(0, cy - h / 2), w, h };
  }
  let img = sharp(src).extract(toPixels(box, m.width!, m.height!));
  if (ref.aug) img = sharp(await img.toBuffer()).rotate(4, { background: "#777" }).modulate({ brightness: 1.12, saturation: 0.9 });
  return img.resize(side, side, { fit: "inside", withoutEnlargement: false }).jpeg({ quality: 88 }).toBuffer();
}

async function main() {
  const model = process.argv[2] ?? "gemma4:e4b";
  const v4 = process.argv.includes("--v4");
  const v3 = process.argv.includes("--v3");
  const v2 = v4 || v3 || process.argv.includes("--v2");
  const tag = v4 ? "v4" : v3 ? "v3-extended" : (process.env.COMPARE_TAG ?? "v2");
  const out = path.join(ROOT, "compare", model.replace(/[:/]/g, "_") + (v2 ? `-${tag}` : ""));
  await fs.mkdir(out, { recursive: true });
  const rows: Array<{ id: string; kind: Pair["kind"]; expected: boolean; said: boolean; correct: boolean; confidence?: number; shows?: string; ms: number; sameKind?: boolean; details?: string[] }> = [];
  for (const p of PAIRS) {
    const a = await render(p.target, 768);
    const b = await render(p.found, 1024);
    await fs.writeFile(path.join(out, `${p.id}-target.jpg`), a);
    await fs.writeFile(path.join(out, `${p.id}-found.jpg`), b);
    if (v4 || v3) {
      const j = v4 ? await judgeFound(a, b, p.label, [], { model }) : await compareWithTarget(a, b, p.label, { model });
      const expected = p.kind.startsWith("positive");
      const said = j.verdict === "found";
      rows.push({ id: p.id, kind: p.kind, expected, said, correct: expected === said, shows: j.shows, ms: j.ms, sameKind: j.verdict === "almost", details: j.details });
      console.log(`${expected === said ? "✓" : "✗"} ${p.id.padEnd(26)} expected=${expected} verdict=${j.verdict} ${j.ms}ms — ${j.shows}`);
      continue;
    }
    const r = v2
      ? await chat({ model, prompt: COMPARE2_PROMPT(p.label), images: [a, b], format: compare2Schema, options: { temperature: 0 } })
      : await chat({ model, prompt: COMPARE_PROMPT(p.label), images: [a, b], format: compareSchema, options: { temperature: 0 } });
    const v = extractJson(r.content) as
      | { image2_shows?: string; same_target?: boolean; confidence?: number; same_object?: boolean; same_kind?: boolean; target_details?: string[] }
      | undefined;
    const expected = p.kind.startsWith("positive");
    const verdict = v2 ? verdictFrom(v, p.label).verdict : undefined;
    const said = v2 ? verdict === "found" : v?.same_target === true;
    rows.push({ id: p.id, kind: p.kind, expected, said, correct: expected === said, confidence: v?.confidence, shows: v?.image2_shows, ms: r.ms, sameKind: v2 ? verdict === "almost" : v?.same_kind, details: v?.target_details });
    console.log(`${expected === said ? "✓" : "✗"} ${p.id.padEnd(26)} expected=${expected} said=${said}${v2 ? ` kind=${v?.same_kind}` : ` conf=${v?.confidence}`} ${r.ms}ms — ${v?.image2_shows}${v2 ? ` | details: ${(v?.target_details ?? []).join("; ")}` : ""}`);
  }
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify(rows, null, 2));
  const by = (k: string) => rows.filter((r) => r.kind === k);
  for (const k of ["positive", "positive_aug", "hard_negative", "negative"]) {
    const xs = by(k);
    console.log(`${k}: ${xs.filter((r) => r.correct).length}/${xs.length} correct`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
