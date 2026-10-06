/**
 * Build spike/data/report.html: per-run metrics plus every candidate with its
 * real crop, the model's words, the crop-only verification, and the human
 * label. Run: npx tsx spike/src/report.ts run1 run2 ...
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Candidate, ImageResult } from "./run.ts";
import { rejectTarget } from "../../src/lib/hunt/filters";

const ROOT = path.join(process.cwd(), "spike/data");

/** Human judgement for one candidate. */
export type Label = {
  contains: "yes" | "partial" | "no"; // does the box hold the described thing?
  exists?: boolean; // is the described thing anywhere in the photo? (when contains = no)
  findable: boolean; // specific + reachable + recognisable on site
  interesting: 0 | 1 | 2;
  clue: 0 | 1 | 2;
  safe: boolean;
  note?: string;
};
type Labels = Record<string, Label>; // key: `${run}/${image}#${idx}`

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "–");

export const isValid = (l?: Label) => !!l && l.contains === "yes" && l.findable && l.safe;
export const isGood = (l?: Label) => isValid(l) && l!.interesting >= 1 && l!.clue >= 1;
/** Lenient: the box overlaps the target (the padded reveal crop shows it). */
export const isUsable = (l?: Label) => !!l && l.contains !== "no" && l.findable && l.safe;
export const isUsableGood = (l?: Label) => isUsable(l) && l!.interesting >= 1 && l!.clue >= 1;

function visible(c: Candidate) {
  return !!c.verify && "visible" in c.verify && c.verify.visible;
}
function mcqPass(c: Candidate) {
  return !!c.mcq && "pass" in c.mcq && c.mcq.pass;
}
/** What the game would accept: parsed box, passes cheap filters, passes the MCQ verifier. */
export function pipelinePass(c: Candidate) {
  const people = !!c.mcq && "people" in c.mcq && c.mcq.people === true;
  return !!c.box && !c.rejected && mcqPass(c) && !people;
}

async function loadRun(run: string) {
  const dir = path.join(ROOT, "runs", run);
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const results = await Promise.all(files.map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as ImageResult));
  // Re-apply the current cheap filters so filter changes apply retroactively.
  for (const r of results) for (const c of r.candidates) c.rejected = c.box ? rejectTarget(c.label, c.box) : undefined;
  return results;
}

function metrics(run: string, results: ImageResult[], labels: Labels) {
  const all = results.flatMap((r) => r.candidates.map((c) => ({ r, c, l: labels[`${run}/${r.image}#${c.idx}`] })));
  const labelled = all.filter((x) => x.l);
  const withBox = all.filter((x) => x.c.box);
  const verified = all.filter((x) => visible(x.c));
  const verifiedLabelled = verified.filter((x) => x.l);
  const passed = all.filter((x) => pipelinePass(x.c));
  const passedLabelled = passed.filter((x) => x.l);
  const mcqLabelled = all.filter((x) => mcqPass(x.c) && x.l);
  const proposeMs = results.flatMap((r) => r.calls.filter((c) => c.kind.startsWith("propose") || c.kind === "ground"));
  const verifyMs = results.flatMap((r) => r.calls.filter((c) => c.kind === "mcq"));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const perImageSearch = results.map((r) => sum(r.calls.filter((c) => c.kind !== "verify" && c.kind !== "mcq").map((c) => c.ms)));
  // Pipeline view: first verified candidate per image (the one the game would use).
  const picks = results.map((r) => {
    const c = r.chosen !== undefined ? r.candidates.find((c) => c.idx === r.chosen) : r.strategy === "v4" ? undefined : r.candidates.find((c) => pipelinePass(c));
    return { r, c, l: c ? labels[`${run}/${r.image}#${c.idx}`] : undefined };
  });
  const labelledPicks = picks.filter((p) => p.c && p.l);
  const recallBase = labelled.filter((x) => isValid(x.l));
  return {
    run,
    images: results.length,
    candidates: all.length,
    boxOk: pct(withBox.length, all.length),
    labelled: labelled.length,
    containsYes: pct(labelled.filter((x) => x.l!.contains === "yes").length, labelled.length),
    containsPartial: pct(labelled.filter((x) => x.l!.contains === "partial").length, labelled.length),
    hallucinated: pct(labelled.filter((x) => x.l!.contains === "no" && x.l!.exists === false).length, labelled.length),
    valid: pct(labelled.filter((x) => isValid(x.l)).length, labelled.length),
    good: pct(labelled.filter((x) => isGood(x.l)).length, labelled.length),
    rejected: pct(all.filter((x) => x.c.rejected).length, all.length),
    yesnoPrecision: pct(verifiedLabelled.filter((x) => isValid(x.l)).length, verifiedLabelled.length),
    yesnoRecall: pct(recallBase.filter((x) => visible(x.c)).length, recallBase.length),
    mcqPrecision: pct(mcqLabelled.filter((x) => isValid(x.l)).length, mcqLabelled.length),
    mcqRecall: pct(recallBase.filter((x) => mcqPass(x.c)).length, recallBase.length),
    passRate: pct(passed.length, all.length),
    passPrecision: pct(passedLabelled.filter((x) => isValid(x.l)).length, passedLabelled.length),
    imagesWithPick: pct(picks.filter((p) => p.c).length, results.length),
    pickValid: pct(labelledPicks.filter((p) => isValid(p.l)).length, labelledPicks.length),
    pickGood: pct(labelledPicks.filter((p) => isGood(p.l)).length, labelledPicks.length),
    pickUsable: pct(labelledPicks.filter((p) => isUsable(p.l)).length, labelledPicks.length),
    pickUsableGood: pct(labelledPicks.filter((p) => isUsableGood(p.l)).length, labelledPicks.length),
    usable: pct(labelled.filter((x) => isUsable(x.l)).length, labelled.length),
    imagesWithGood: pct(
      results.filter((r) => r.candidates.some((c) => isGood(labels[`${run}/${r.image}#${c.idx}`]))).length,
      results.length,
    ),
    medianWaitS: (() => {
      const s = results.map((r) => r.waitMs ?? 0).filter(Boolean).sort((a, b) => a - b);
      return s.length ? (s[Math.floor(s.length / 2)] / 1000).toFixed(1) : "–";
    })(),
    medianSearchS: (() => {
      const s = [...perImageSearch].sort((a, b) => a - b);
      return s.length ? (s[Math.floor(s.length / 2)] / 1000).toFixed(1) : "–";
    })(),
    medianVerifyS: (() => {
      const s = verifyMs.map((c) => c.ms).sort((a, b) => a - b);
      return s.length ? (s[Math.floor(s.length / 2)] / 1000).toFixed(1) : "–";
    })(),
    outTokPerCand: all.length ? Math.round(sum(proposeMs.map((c) => c.outputTokens)) / all.length) : 0,
  };
}

const COLUMNS: Array<[keyof ReturnType<typeof metrics>, string, string]> = [
  ["run", "Run", ""],
  ["images", "Imgs", ""],
  ["candidates", "Cands", ""],
  ["boxOk", "Box parsed", "Box present, 4 numbers, not degenerate, not >60% of frame"],
  ["containsYes", "Box ✓", "Human: box contains the described target"],
  ["containsPartial", "Box ~", "Human: box partially contains it / mislabeled but real"],
  ["hallucinated", "Halluc.", "Human: described target is nowhere in the photo"],
  ["valid", "Valid", "Box ✓ + findable + safe"],
  ["good", "Good", "Valid + interesting ≥1 + clue ≥1"],
  ["rejected", "Filtered", "Cheap filters: mass noun / person / box > 15% of frame"],
  ["yesnoPrecision", "Y/N prec.", "Yes/no verifier: of accepted, share human-valid"],
  ["yesnoRecall", "Y/N recall", "Yes/no verifier: of human-valid, share accepted"],
  ["mcqPrecision", "MCQ prec.", "Multiple-choice verifier: of accepted, share human-valid"],
  ["mcqRecall", "MCQ recall", "Multiple-choice verifier: of human-valid, share accepted"],
  ["passRate", "Pipeline pass", "Box + filters + MCQ"],
  ["passPrecision", "Pass → valid", "Of pipeline-passed, share human-valid"],
  ["imagesWithPick", "Imgs with pick", "Images where at least one candidate passes the pipeline"],
  ["pickValid", "Pick valid", "First pipeline-passed candidate per image: human-valid"],
  ["pickGood", "Pick good", "First pipeline-passed candidate per image: human-good"],
  ["usable", "Usable", "Lenient valid: box overlaps target (yes or partial) + findable + safe"],
  ["pickUsable", "Pick usable", "First pipeline-passed candidate: lenient valid"],
  ["pickUsableGood", "Pick usable+good", "First pipeline-passed candidate: lenient valid + interesting + clue"],
  ["imagesWithGood", "Imgs w/ good", "Images with at least one human-good candidate"],
  ["medianWaitS", "Wait s", "v4: median seconds a player waits (propose + verify until pick + write)"],
  ["medianSearchS", "Search s", "Median seconds per image to propose (+ground)"],
  ["medianVerifyS", "Verify s", "Median seconds per crop verification"],
  ["outTokPerCand", "Tok/cand", "Output tokens per candidate in the proposal"],
];

async function main() {
  const runs = process.argv.slice(2);
  const labels: Labels = JSON.parse(await fs.readFile(path.join(ROOT, "labels.json"), "utf8").catch(() => "{}"));
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "images/manifest.json"), "utf8")) as Array<{
    id: string; scene: string; source: string; license: string; artist: string;
  }>;
  const loaded = await Promise.all(runs.map(async (run) => ({ run, results: await loadRun(run) })));
  const table = loaded.map(({ run, results }) => metrics(run, results, labels));
  await fs.writeFile(path.join(ROOT, "metrics.json"), JSON.stringify(table, null, 2));

  const label = (l?: Label) =>
    !l
      ? `<span class="tag muted">unlabelled</span>`
      : `<span class="tag ${isGood(l) ? "good" : isValid(l) ? "ok" : "bad"}">${isGood(l) ? "GOOD" : isValid(l) ? "VALID" : "INVALID"}</span>
         <span class="small">box ${l.contains}${l.exists === false ? " · hallucinated" : ""} · findable ${l.findable ? "✓" : "✗"} · interest ${l.interesting} · clue ${l.clue}${l.safe ? "" : " · UNSAFE"}</span>
         ${l.note ? `<div class="note">${esc(l.note)}</div>` : ""}`;

  const picksRun = loaded.find((x) => x.run === process.env.PICKS_RUN) ?? loaded.at(-1)!;
  const picks = picksRun.results
    .map((r) => {
      const c = r.chosen !== undefined && r.chosen !== null ? r.candidates.find((x) => x.idx === r.chosen) : undefined;
      const l = c ? labels[`${picksRun.run}/${r.image}#${c.idx}`] : undefined;
      const spatial = (c as (Candidate & { spatial?: string }) | undefined)?.spatial;
      return `<article class="pick">
        <img class="photo" loading="lazy" src="images/${r.image}.jpg" alt="wide photo ${r.image}">
        ${c ? `<img class="crop" loading="lazy" src="runs/${picksRun.run}/${c.crop}" alt="target crop">` : `<div class="nocrop">No target trusted</div>`}
        <div class="meta">
          <div class="small">${r.image} · ${esc(manifest.find((m) => m.id === r.image)?.scene)} · wait ${(((r.waitMs ?? 0) as number) / 1000).toFixed(0)} s</div>
          ${c ? `<div class="kicker">I FOUND SOMETHING.</div><div class="clue big">${esc(c.clue)}</div>
          <div class="small"><b>Hint 1</b> ${esc(c.hint_semantic)}</div>
          <div class="small"><b>Hint 2</b> ${esc(c.hint_concrete)}</div>
          <div class="small"><b>Hint 3</b> ${esc(spatial)}</div>
          <div class="small"><b>Secret</b> ${esc(c.label)} <span class="muted">(${esc(c.lens)})</span></div>
          <div class="small"><b>Reveal</b> ${esc(c.reveal)}</div>
          <div>${label(l)}</div>` : `<div class="small">The engine found nothing it could verify; the app would say so and ask for another view.</div>`}
        </div></article>`;
    })
    .join("");

  const compareDirs = await fs.readdir(path.join(ROOT, "compare")).catch(() => [] as string[]);
  const compares = await Promise.all(
    compareDirs.map(async (d) => ({
      d,
      rows: JSON.parse(await fs.readFile(path.join(ROOT, "compare", d, "results.json"), "utf8").catch(() => "[]")) as Array<{
        id: string; kind: string; expected: boolean; said: boolean; correct: boolean; sameKind?: boolean; shows?: string; ms: number;
      }>,
    })),
  );
  const compareHtml = compares
    .filter((c) => c.rows.length)
    .map(({ d, rows }) => {
      const tally = ["positive", "positive_aug", "hard_negative", "negative"]
        .map((k) => `${k}: ${rows.filter((r) => r.kind === k && r.correct).length}/${rows.filter((r) => r.kind === k).length}`)
        .join(" · ");
      return `<details><summary><h3>FOUND IT check — ${esc(d)}</h3> <span class="small">${tally}</span></summary><div class="pairs">${rows
        .map(
          (r) => `<div class="pair ${r.correct ? "" : "wrong"}"><img loading="lazy" src="compare/${d}/${r.id}-target.jpg" alt="target"><img loading="lazy" src="compare/${d}/${r.id}-found.jpg" alt="found">
          <div class="small"><b>${r.correct ? "✓" : "✗"} ${esc(r.id)}</b> expected ${r.expected ? "same" : "different"}, said ${r.said ? "same" : "different"}${r.sameKind !== undefined ? ` (same kind: ${r.sameKind})` : ""} · ${(r.ms / 1000).toFixed(1)} s<br>${esc(r.shows)}</div></div>`,
        )
        .join("")}</div></details>`;
    })
    .join("");

  const sections = loaded
    .map(({ run, results }) => {
      const imgs = results
        .map((r) => {
          const m = manifest.find((x) => x.id === r.image);
          const cards = r.candidates
            .map((c) => {
              const v = c.verify && "visible" in c.verify ? c.verify : undefined;
              return `<div class="card">
                ${c.crop ? `<img loading="lazy" src="runs/${run}/${c.crop}" alt="crop ${c.idx}">` : `<div class="nocrop">${esc(c.boxProblem ?? "no box")}</div>`}
                <div class="meta">
                  <div><b>#${c.idx}</b> ${esc(c.label)}</div>
                  <div class="small">${esc(c.lens)} · ${esc(c.difficulty)} · ${esc(c.source)}${c.boxWarnings?.length ? " · " + esc(c.boxWarnings.join(",")) : ""}</div>
                  <div class="clue">“${esc(c.clue)}”</div>
                  <div class="small">H1 ${esc(c.hint_semantic)}</div>
                  <div class="small">H2 ${esc(c.hint_concrete)}</div>
                  <div class="small">Reveal: ${esc(c.reveal)}</div>
                  <div class="small">Y/N verifier: ${v ? (v.visible ? "✓" : "✗") + " — " + esc(v.what_i_see) : "–"}</div>
                  <div class="small">MCQ: ${c.mcq && "pass" in c.mcq ? (c.mcq.pass ? "✓" : "✗") + ` (said ${esc(c.mcq.answer)}, correct ${esc(c.mcq.correct)}) — ${esc(c.mcq.what_i_see)}` : "–"}${c.rejected ? ` · <b class="bad">filtered: ${esc(c.rejected)}</b>` : ""}${pipelinePass(c) ? ` · <b class="good">PASSES</b>` : ""}</div>
                  <div>${label(labels[`${run}/${r.image}#${c.idx}`])}</div>
                </div></div>`;
            })
            .join("");
          return `<section class="img"><h3>${r.image} <span class="small">${esc(m?.scene)} · <a href="${esc(m?.source)}">source</a> · ${esc(m?.license)}</span></h3>
            ${r.error ? `<div class="bad">${esc(r.error)}</div>` : ""}
            ${r.seen ? `<div class="small">Seen: ${esc(r.seen.join(" · "))}</div>` : ""}
            <div class="row"><img class="overlay" loading="lazy" src="runs/${run}/overlays/${r.image}.jpg" alt="overlay ${r.image}"><div class="cards">${cards}</div></div></section>`;
        })
        .join("");
      return `<details><summary><h2>${esc(run)}</h2></summary>${imgs}</details>`;
    })
    .join("");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spike report — Can You Find It?</title>
<style>
:root{--bg:#f6f4ef;--fg:#1b1b1b;--muted:#6b675f;--line:#ddd8cc;--good:#1f7a3a;--ok:#8a6d00;--bad:#b3261e}
@media (prefers-color-scheme: dark){:root{--bg:#141412;--fg:#ecebe6;--muted:#a19d93;--line:#34322d;--good:#6fd08c;--ok:#e3c25a;--bad:#ff8a80}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif;margin:0 auto;padding:24px 16px;max-width:1500px}
h1{font:600 28px/1.1 Georgia,serif;margin:0 0 8px} h2{display:inline;font:600 20px Georgia,serif} h3{margin:24px 0 8px}
table{border-collapse:collapse;margin:16px 0;font-variant-numeric:tabular-nums}
td,th{border-bottom:1px solid var(--line);padding:6px 10px;text-align:right} th{font-weight:600;text-align:right;cursor:help} td:first-child,th:first-child{text-align:left}
details{border-top:1px solid var(--line);padding:12px 0} summary{cursor:pointer}
.row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
.overlay{width:520px;max-width:100%;border-radius:4px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(250px,100%),1fr));gap:12px;flex:1;min-width:min(300px,100%)}
.card{border:1px solid var(--line);border-radius:6px;overflow:hidden} .card img{width:100%;aspect-ratio:1;object-fit:contain;background:#000;display:block}
.nocrop{aspect-ratio:1;display:grid;place-items:center;background:#000;color:#f88}
.meta{padding:8px} .small{font-size:12px;color:var(--muted)} .clue{font-family:Georgia,serif;font-size:15px;margin:4px 0}
.tag{display:inline-block;font-size:11px;font-weight:700;padding:1px 6px;border-radius:3px;border:1px solid}
.picks{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(420px,100%),1fr));gap:20px}
.scroll{overflow-x:auto;max-width:100%}
.meta{min-width:0;overflow-wrap:anywhere}
.pick{border:1px solid var(--line);border-radius:8px;overflow:hidden;display:grid;grid-template-columns:1fr 1fr}
.pick .photo,.pick .crop,.pick .nocrop{width:100%;aspect-ratio:1;object-fit:cover;display:block;background:#000}
.pick .nocrop{display:grid;place-items:center;color:#aaa}
.pick .meta{grid-column:1/3}
.kicker{font:700 11px/1 ui-sans-serif,system-ui;letter-spacing:.12em;margin-top:6px}
.clue.big{font-size:20px;line-height:1.25;margin:6px 0 8px}
.pairs{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:12px}
.pair{border:1px solid var(--line);border-radius:6px;padding:6px;display:grid;grid-template-columns:1fr 1fr;gap:6px}
.pair img{width:100%;aspect-ratio:1;object-fit:cover;background:#000}
.pair .small{grid-column:1/3}
.pair.wrong{border-color:var(--bad)}
.good{color:var(--good)} .ok{color:var(--ok)} .bad{color:var(--bad)} .muted{color:var(--muted)} .note{font-size:12px;font-style:italic}
</style></head><body>
<h1>Can You Find It? — technical spike</h1>
<p class="small">Generated ${new Date().toISOString()}. Boxes drawn on crops are exactly what the model returned. Labels are human judgements, not model self-assessment. Hover column headers for definitions.</p>
<div class="scroll"><table><thead><tr>${COLUMNS.map(([, h, t]) => `<th title="${esc(t)}">${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${table.map((m) => `<tr>${COLUMNS.map(([k]) => `<td>${esc(m[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
<h2>Rounds the engine would play (${esc(picksRun.run)})</h2>
<p class="small">One round per photo: the wide photo, the crop the reveal would show (yellow box = model's box), the human-written clue line the model selected, the model-written hints, the box-derived spatial hint, and the human label.</p>
<div class="picks">${picks}</div>
${compareHtml}
<h2>All candidates by run</h2>
${sections}
<h2>Photo credits</h2><ul class="small">${manifest.map((m) => `<li>${m.id}: ${esc(m.artist)} — ${esc(m.license)} — <a href="${esc(m.source)}">${esc(m.source)}</a></li>`).join("")}</ul>
</body></html>`;
  await fs.writeFile(path.join(ROOT, "report.html"), html);
  console.table(table.map((m) => Object.fromEntries(COLUMNS.map(([k, h]) => [h, m[k]]))));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
