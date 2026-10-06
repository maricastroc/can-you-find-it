/**
 * Re-run selection on an existing run's proposals with the current engine
 * policy (filters, verification wording, ranking, lens choice), so policy
 * changes are measured on the very same, already-labelled candidates.
 *
 *   npx tsx spike/src/simulate.ts v4-e4b v4b-e4b
 */
import fs from "node:fs/promises";
import path from "node:path";
import { extractJson } from "../../src/lib/hunt/json";
import { rank, screen, spatialHint, verifyCandidate, writeTexts, type EngineCandidate, type Proposal } from "../../src/lib/hunt/engine";
import type { Candidate, ImageResult } from "./run.ts";

const [from, to] = process.argv.slice(2);
const ROOT = "spike/data";
const model = "gemma4:e4b";
await fs.mkdir(path.join(ROOT, "runs", to), { recursive: true });
const labels = JSON.parse(await fs.readFile(path.join(ROOT, "labels.json"), "utf8")) as Record<string, unknown>;

for (const f of (await fs.readdir(path.join(ROOT, "runs", from))).filter((f) => f.endsWith(".json")).sort()) {
  const out = path.join(ROOT, "runs", to, f);
  if (await fs.stat(out).then(() => true, () => false)) continue;
  const prev = JSON.parse(await fs.readFile(path.join(ROOT, "runs", from, f), "utf8")) as ImageResult & { chosen?: number };
  const raw = extractJson(prev.calls.find((c) => c.kind === "propose")!.raw) as { targets: Proposal[] };
  const image = await fs.readFile(path.join(ROOT, "images", `${prev.image}.jpg`));
  const cands: EngineCandidate[] = raw.targets.map((p, idx) => ({ ...p, idx, ...screen(p) }));
  let waitMs = prev.calls.find((c) => c.kind === "propose")!.ms;
  let chosen: EngineCandidate | undefined;
  for (const c of rank(cands)) {
    const v = await verifyCandidate(image, c, cands, { model });
    c.verify = v.verify;
    if (!chosen) waitMs += v.step.ms;
    if (v.verify.pass && !chosen) chosen = c;
  }
  const w = chosen ? await writeTexts(image, chosen, { model }) : undefined;
  if (w) waitMs += w.step.ms;
  const candidates: Candidate[] = cands.map((c) => {
    const p = prev.candidates[c.idx];
    const o: Candidate = { idx: c.idx, source: "full", label: c.label, box_2d: c.box_2d, box: c.box, boxProblem: c.boxProblem, rejected: c.rejected, difficulty: c.difficulty, crop: p?.crop ? `../${from}/${p.crop}` : undefined };
    if (c.verify) o.mcq = { options: c.verify.options, correct: c.label, answer: c.verify.answer, what_i_see: c.verify.what_i_see, people: c.verify.personAtTarget, pass: c.verify.pass, ms: 0 };
    if (chosen && c.idx === chosen.idx && w?.texts) {
      Object.assign(o, { clue: w.texts.clue, lens: w.texts.lens, hint_semantic: w.texts.hint_semantic, hint_concrete: w.texts.hint_concrete, reveal: `${w.texts.detail} (evidence: ${w.texts.evidence})` });
      (o as Candidate & { spatial?: string }).spatial = spatialHint(c.box!);
    }
    // Same proposal, same box: carry the human label over.
    const key = `${from}/${prev.image}#${c.idx}`;
    if (labels[key] && !labels[`${to}/${prev.image}#${c.idx}`]) labels[`${to}/${prev.image}#${c.idx}`] = labels[key];
    return o;
  });
  const res = { ...prev, strategy: "v4", calls: prev.calls, candidates, chosen: chosen?.idx, waitMs };
  await fs.writeFile(out, JSON.stringify(res, null, 2));
  const ch = chosen ? candidates[chosen.idx] : undefined;
  console.log(`${prev.image}: was=${prev.chosen ?? "none"} now=${chosen?.idx ?? "none"} ${ch ? JSON.stringify(ch.label) + " → " + ch.lens + " " + JSON.stringify(ch.clue) : ""}`);
}
await fs.writeFile(path.join(ROOT, "labels.json"), JSON.stringify(labels, null, 1));
