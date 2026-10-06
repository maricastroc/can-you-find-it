import fs from "node:fs/promises";
import sharp from "sharp";
import { cropFor, findTarget, VERIFY_SIDE, writeTexts } from "../src/lib/hunt/engine";
import { judgeFound } from "../src/lib/hunt/check";
import { chat, type ChatInput } from "../src/lib/hunt/ollama";
import { config } from "../src/lib/hunt/config";
import { kindOf } from "../src/lib/hunt/replay";

type Recorded = { kind: string; prompt: string; content: string; ms: number };

function recorder() {
  const calls: Recorded[] = [];
  const fn = async (input: ChatInput) => {
    const r = await chat(input);
    calls.push({ kind: kindOf(input), prompt: input.prompt.slice(0, 160), content: r.content, ms: r.ms });
    return r;
  };
  return { calls, fn };
}

const OUT = "src/lib/hunt/__fixtures__";
for (const id of ["c030", "c117", "c054"]) {
  const photo = await fs.readFile(`spike/data/images/${id}.jpg`);
  const meta = await sharp(photo).metadata();
  const rec = recorder();
  const result = await findTarget(photo, { model: config.model, chat: rec.fn, temperature: 0, verifyAll: true });
  const target = result.candidates.find((c) => c.idx === result.chosen);
  if (target && result.lens) await writeTexts(photo, target, { model: config.model, chat: rec.fn }, result.lens);
  await fs.writeFile(
    `${OUT}/round-${id}.json`,
    JSON.stringify({ image: id, width: meta.width, height: meta.height, model: config.model, chosen: result.chosen, label: target?.label, lens: result.lens, calls: rec.calls }, null, 2) + "\n",
  );
  console.log(id, "chosen", result.chosen, target?.label, "→", result.clue);
  if (id === "c030" && target?.box) {
    const { buffer } = await cropFor(photo, target.box, "verify", VERIFY_SIDE);
    const W = meta.width!, H = meta.height!;
    const shots = [
      ["pos", target.box.x - 0.03, target.box.y - 0.05, target.box.w + 0.08, target.box.h + 0.1],
      ["neg", 0.55, 0.55, 0.2, 0.25],
    ] as const;
    for (const [name, x, y, w, h] of shots) {
      const left = Math.max(0, Math.round(x * W));
      const top = Math.max(0, Math.round(y * H));
      const found = await sharp(photo)
        .extract({ left, top, width: Math.min(W - left, Math.round(w * W)), height: Math.min(H - top, Math.round(h * H)) })
        .jpeg()
        .toBuffer();
      const rec2 = recorder();
      const others = result.candidates.filter((c) => c.idx !== target.idx).map((c) => c.label);
      const check = await judgeFound(buffer, found, target.label, others, { model: config.model, chat: rec2.fn });
      await fs.writeFile(`${OUT}/check-${id}-${name}.json`, JSON.stringify({ label: target.label, verdict: check.verdict, calls: rec2.calls }, null, 2) + "\n");
      console.log("check", name, check.verdict);
    }
  }
}
