/** Print original vs "zoom then write" clues side by side for rating. */
import fs from "node:fs/promises";
import path from "node:path";
const run = process.argv[2];
const dir = path.join("spike/data/runs", run);
const labels = JSON.parse(await fs.readFile("spike/data/labels.json", "utf8")) as Record<string, { clue: number; note?: string }>;
for (const f of (await fs.readdir(path.join(dir, "written"))).sort()) {
  const written = JSON.parse(await fs.readFile(path.join(dir, "written", f), "utf8")) as Record<string, { clue: string; hint_semantic: string; hint_concrete: string; reveal: string; what_is_special: string; lens: string }>;
  const r = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as { image: string; candidates: Array<{ idx: number; label: string; clue: string; hint_semantic: string }> };
  for (const [idx, w] of Object.entries(written)) {
    const c = r.candidates[Number(idx)];
    const l = labels[`${run}/${r.image}#${idx}`];
    console.log(`\n${r.image}#${idx} — ${c.label}`);
    console.log(`  single [${l?.clue}]: ${c.clue}`);
    console.log(`  writer     : ${w.clue}   (${w.lens}; special: ${w.what_is_special})`);
    console.log(`    h1: ${w.hint_semantic}\n    h2: ${w.hint_concrete}\n    reveal: ${w.reveal}`);
  }
}
