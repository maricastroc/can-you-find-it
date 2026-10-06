/** Draw a labelled 10x10 grid over images so crops can be specified by hand. */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const [dir, ...ids] = process.argv.slice(2);
await fs.mkdir("spike/data/grid", { recursive: true });
for (const id of ids) {
  const src = path.join(dir, `${id}.jpg`);
  const img = sharp(src).resize(1000, 1000, { fit: "inside" });
  const buf = await img.toBuffer();
  const m = await sharp(buf).metadata();
  const W = m.width!, H = m.height!;
  let svg = `<svg width="${W}" height="${H}">`;
  for (let i = 1; i < 10; i++) {
    svg += `<line x1="${(i * W) / 10}" y1="0" x2="${(i * W) / 10}" y2="${H}" stroke="#0ff" stroke-opacity="0.6"/>`;
    svg += `<line x1="0" y1="${(i * H) / 10}" x2="${W}" y2="${(i * H) / 10}" stroke="#0ff" stroke-opacity="0.6"/>`;
    svg += `<text x="${(i * W) / 10 + 2}" y="12" font-size="12" fill="#0ff" font-family="Helvetica">${i}</text>`;
    svg += `<text x="2" y="${(i * H) / 10 - 2}" font-size="12" fill="#0ff" font-family="Helvetica">${i}</text>`;
  }
  svg += `</svg>`;
  await sharp(buf).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 80 }).toFile(`spike/data/grid/${id}.jpg`);
}
