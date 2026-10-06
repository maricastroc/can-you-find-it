import fs from "node:fs/promises";
import path from "node:path";
import { chooseLens } from "../../src/lib/hunt/engine";
import { LENS_MENU } from "./prompts-legacy.ts";
import { rejectTarget } from "../../src/lib/hunt/filters";
import type { ImageResult } from "./run.ts";
const run = process.argv[2];
const dir = path.join("spike/data/runs", run);
const labels = JSON.parse(await fs.readFile("spike/data/labels.json", "utf8")) as Record<string, { contains: string; findable: boolean; interesting: number; safe: boolean }>;
for (const f of (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
  const r = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as ImageResult;
  if (r.chosen === undefined) { console.log(`${r.image}: none`); continue; }
  const c = r.candidates[r.chosen];
  const rej = c.box ? rejectTarget(c.label, c.box) : undefined;
  const lens = chooseLens(c.label, c.lens, c.box!);
  const changed = lens !== c.lens;
  if (changed) {
    c.lens = lens;
    c.clue = LENS_MENU.find((l) => l.id === lens)!.line;
    await fs.writeFile(path.join(dir, f), JSON.stringify(r, null, 2));
  }
  const l = labels[`${run}/${r.image}#${c.idx}`];
  console.log(`${r.image}#${c.idx} ${JSON.stringify(c.label)} → ${lens}${changed ? " (changed)" : ""}${rej ? " NOW-FILTERED:" + rej : ""} | label: ${l ? `${l.contains} f=${l.findable} i=${l.interesting} s=${l.safe}` : "none"}`);
}
