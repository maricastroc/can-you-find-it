import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { chat } from "../../src/lib/hunt/ollama";
import { extractJson } from "../../src/lib/hunt/json";
import { LENS_MENU, MENU_WRITER_PROMPT, MENU_WRITER_SYSTEM, menuWriterSchema, WRITER_PROMPT, WRITER_SYSTEM, writerSchema } from "./prompts-legacy.ts";
import type { ImageResult } from "./run.ts";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { model: { type: "string", default: "gemma4:e4b" }, all: { type: "boolean", default: false }, max: { type: "string", default: "2" }, menu: { type: "boolean", default: false } },
});
const run = positionals[0];
const ROOT = path.join(process.cwd(), "spike/data");
const dir = path.join(ROOT, "runs", run);
const labels = JSON.parse(await fs.readFile(path.join(ROOT, "labels.json"), "utf8").catch(() => "{}")) as Record<string, { contains: string; findable: boolean; safe: boolean }>;
const sub = args.menu ? "written-menu" : "written";
await fs.mkdir(path.join(dir, sub), { recursive: true });

for (const f of (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
  const r = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as ImageResult;
  const out = path.join(dir, sub, f);
  if (await fs.stat(out).then(() => true, () => false)) continue;
  const scene = await sharp(path.join(ROOT, "images", `${r.image}.jpg`)).resize(768, 768, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
  const written: Record<number, unknown> = {};
  for (const c of r.candidates) {
    if (!c.verifyCrop) continue;
    const l = labels[`${run}/${r.image}#${c.idx}`];
    if (!args.all && !(l && l.contains !== "no" && l.findable && l.safe)) continue;
    if (Object.keys(written).length >= Number(args.max)) break;
    const crop = await fs.readFile(path.join(dir, c.verifyCrop));
    const res = args.menu
      ? await chat({ model: args.model!, system: MENU_WRITER_SYSTEM, prompt: MENU_WRITER_PROMPT(c.label), images: [crop, scene], format: menuWriterSchema, options: { temperature: 0.3 } })
      : await chat({ model: args.model!, system: WRITER_SYSTEM, prompt: WRITER_PROMPT(c.label), images: [crop, scene], format: writerSchema, options: { temperature: 0.7 } });
    const parsed = extractJson(res.content) as { lens?: string; clue?: string } | undefined;
    const clue = args.menu ? LENS_MENU.find((l) => l.id === parsed?.lens)?.line : parsed?.clue;
    written[c.idx] = { ...(parsed as object), clue, ms: res.ms, outputTokens: res.outputTokens };
    console.log(r.image, c.idx, res.ms + "ms", JSON.stringify(c.label), "→", parsed?.lens, JSON.stringify(clue));
  }
  await fs.writeFile(out, JSON.stringify(written, null, 2));
}
