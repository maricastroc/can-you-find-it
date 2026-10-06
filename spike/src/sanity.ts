import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { chat } from "../../src/lib/hunt/ollama";

const model = process.argv[2] ?? "gemma4:e4b";
const id = process.argv[3] ?? "c000";
const img = await fs.readFile(path.join("spike/data/images", `${id}.jpg`));
const meta = await sharp(img).metadata();

// 1) How many prompt tokens does an image cost at each resolution?
for (const side of process.env.SKIP_BUDGET ? [] : [768, 1280, 1920, 2560]) {
  const b = await sharp(img).resize(side, side, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
  const r = await chat({ model, prompt: "Reply with OK.", images: [b], options: { temperature: 0, num_predict: 4 } });
  console.log(`side=${side} promptTokens=${r.promptTokens} ms=${r.ms}`);
}

// 2) Native detection prompt (per Google docs).
const b = await sharp(img).resize(1920, 1920, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
const r = await chat({
  model,
  prompt: process.env.DETECT ?? "detect bench, lamp post, person, trash can, output only ```json",
  images: [b],
  options: { temperature: 0 },
});
console.log(r.ms + "ms", r.outputTokens + " tok");
console.log(r.content);
const m = r.content.match(/\[[\s\S]*\]/);
const dets = m ? (JSON.parse(m[0]) as Array<{ box_2d: number[]; label: string }>) : [];
const W = meta.width!, H = meta.height!;
const rects = dets
  .map((d) => {
    const [y1, x1, y2, x2] = d.box_2d.map((v) => v / 1000);
    return `<rect x="${x1 * W}" y="${y1 * H}" width="${(x2 - x1) * W}" height="${(y2 - y1) * H}" fill="none" stroke="#ff0" stroke-width="6"/><text x="${x1 * W + 6}" y="${y1 * H + 40}" font-size="40" fill="#ff0" font-family="Helvetica">${d.label}</text>`;
  })
  .join("");
await fs.mkdir("spike/data/sanity", { recursive: true });
const drawn = await sharp(img).composite([{ input: Buffer.from(`<svg width="${W}" height="${H}">${rects}</svg>`) }]).toBuffer();
await sharp(drawn)
  .resize(1400)
  .jpeg()
  .toFile(`spike/data/sanity/${id}-${model.replace(/[:/]/g, "_")}.jpg`);
