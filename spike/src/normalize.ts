import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const dir = path.join(process.cwd(), "spike/data/images");
for (const f of (await fs.readdir(dir)).filter((f) => f.endsWith(".jpg"))) {
  const p = path.join(dir, f);
  const buf = await sharp(p).rotate().resize(2560, 2560, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  await fs.writeFile(p, buf);
  const m = await sharp(buf).metadata();
  console.log(f, m.width, "x", m.height, (buf.length / 1024).toFixed(0) + "KB");
}
