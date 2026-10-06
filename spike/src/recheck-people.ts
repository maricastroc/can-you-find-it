/**
 * Re-run only the verification step (new "person at target" wording) on
 * candidates that the old "any person visible" check rejected, plus the
 * known occupied bench from v3 (c016#4), to see what the refined check keeps.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chat } from "../../src/lib/hunt/ollama";
import { extractJson } from "../../src/lib/hunt/json";
import { cropFor, shuffle } from "../../src/lib/hunt/engine";
import { GENERIC_DISTRACTORS, MCQ_PROMPT, mcqSchema } from "./prompts-legacy.ts";
import type { ImageResult } from "./run.ts";

const ROOT = "spike/data";
const targets: Array<{ run: string; image: string; idx: number }> = [{ run: "v3-single-e4b", image: "c016", idx: 4 }];
for (const f of (await fs.readdir(path.join(ROOT, "runs/v4-e4b"))).filter((f) => f.endsWith(".json"))) {
  const r = JSON.parse(await fs.readFile(path.join(ROOT, "runs/v4-e4b", f), "utf8")) as ImageResult;
  for (const c of r.candidates) if (c.mcq && "people" in c.mcq && c.mcq.people) targets.push({ run: "v4-e4b", image: r.image, idx: c.idx });
}
for (const t of targets) {
  const r = JSON.parse(await fs.readFile(path.join(ROOT, "runs", t.run, `${t.image}.json`), "utf8")) as ImageResult;
  const c = r.candidates[t.idx];
  const src = await fs.readFile(path.join(ROOT, "images", `${t.image}.jpg`));
  const { buffer } = await cropFor(src, c.box!, "verify");
  const options = shuffle([c.label, ...r.candidates.filter((o) => o !== c).map((o) => o.label), ...GENERIC_DISTRACTORS].slice(0, 4), t.idx + 7);
  const v = await chat({ model: "gemma4:e4b", prompt: MCQ_PROMPT(options), images: [buffer], format: mcqSchema(options), options: { temperature: 0 } });
  const out = extractJson(v.content) as { what_i_see?: string; answer?: string; person_at_target?: boolean };
  console.log(`${t.run}/${t.image}#${t.idx} ${JSON.stringify(c.label)} → match=${out.answer === c.label} person_at_target=${out.person_at_target} | ${out.what_i_see}`);
}
