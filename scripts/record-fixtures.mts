/**
 * Record real model replies for deterministic tests.
 *   npx tsx scripts/record-fixtures.mts
 * Writes src/lib/hunt/__fixtures__/<name>.json: the photo size plus every
 * model call in order (kind, a prompt excerpt, the raw reply).
 */
import fs from "node:fs/promises";
import sharp from "sharp";
import { findTarget, cropFor } from "../src/lib/hunt/engine";
import { compareWithTarget } from "../src/lib/hunt/check";
import { chat, type ChatInput } from "../src/lib/hunt/ollama";
import { config } from "../src/lib/hunt/config";

type Recorded = { kind: string; prompt: string; content: string; ms: number };

function recorder() {
  const calls: Recorded[] = [];
  const fn = async (input: ChatInput) => {
    const r = await chat(input);
    const kind = input.system?.includes("eye of") ? "propose" : input.system?.includes("prepare a secret target") ? "write" : input.prompt.startsWith("Image 1 is a crop") ? "compare" : "verify";
    calls.push({ kind, prompt: input.prompt.slice(0, 160), content: r.content, ms: r.ms });
    return r;
  };
  return { calls, fn };
}

const OUT = "src/lib/hunt/__fixtures__";
for (const id of ["c030", "c117", "c054"]) {
  const photo = await fs.readFile(`spike/data/images/${id}.jpg`);
  const meta = await sharp(photo).metadata();
  const rec = recorder();
  const result = await findTarget(photo, { model: config.model, chat: rec.fn, temperature: 0 });
  await fs.writeFile(`${OUT}/round-${id}.json`, JSON.stringify({ image: id, width: meta.width, height: meta.height, model: config.model, chosen: result.chosen, label: result.candidates.find((c) => c.idx === result.chosen)?.label, calls: rec.calls }, null, 2));
  console.log(id, "chosen", result.chosen, result.texts?.clue);
  if (id === "c030" && result.chosen !== undefined) {
    const target = result.candidates.find((c) => c.idx === result.chosen)!;
    const { buffer } = await cropFor(photo, target.box!, "verify");
    for (const [name, x, y, w, h] of [["pos", target.box!.x - 0.03, target.box!.y - 0.05, target.box!.w + 0.08, target.box!.h + 0.1], ["neg", 0.55, 0.55, 0.2, 0.25]] as const) {
      const W = meta.width!, H = meta.height!;
      const found = await sharp(photo).extract({ left: Math.max(0, Math.round(x * W)), top: Math.max(0, Math.round(y * H)), width: Math.round(w * W), height: Math.round(h * H) }).jpeg().toBuffer();
      const rec2 = recorder();
      const check = await compareWithTarget(buffer, found, target.label, { model: config.model, chat: rec2.fn });
      await fs.writeFile(`${OUT}/check-${id}-${name}.json`, JSON.stringify({ label: target.label, verdict: check.verdict, calls: rec2.calls }, null, 2));
      console.log("check", name, check.verdict);
    }
  }
}
