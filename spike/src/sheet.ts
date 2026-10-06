import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
const run = process.argv[2];
const only = process.argv[3]?.split(",");
const dir = path.join("spike/data/runs", run);
const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json") && (!only || only.includes(f.replace(".json", "")))).sort();
type C = { idx: number; label: string; crop?: string; boxProblem?: string; rejected?: string; verify?: { visible?: boolean }; mcq?: { pass?: boolean; people?: boolean }; clue?: string };
const items: Array<{ img: string; c: C; chosen: boolean }> = [];
for (const f of files) {
  const r = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as { image: string; candidates: C[]; chosen?: number };
  for (const c of r.candidates) items.push({ img: r.image, c, chosen: r.chosen === c.idx });
}
const TILE = 400, CAP = 64, COLS = 4, PER = 16;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const wrap = (s: string, n: number) => { const out: string[] = []; let line = ""; for (const w of s.split(" ")) { if ((line + " " + w).length > n) { out.push(line); line = w; } else line = line ? line + " " + w : w; } out.push(line); return out.slice(0, 3); };
await fs.mkdir(path.join(dir, "sheets"), { recursive: true });
for (let s = 0; s * PER < items.length; s++) {
  const chunk = items.slice(s * PER, (s + 1) * PER);
  const rows = Math.ceil(chunk.length / COLS);
  const comps: OverlayOptions[] = [];
  for (let i = 0; i < chunk.length; i++) {
    const { img, c, chosen } = chunk[i];
    const x = (i % COLS) * TILE, y = Math.floor(i / COLS) * (TILE + CAP);
    if (c.crop) comps.push({ input: await sharp(path.join(dir, c.crop)).resize(TILE, TILE, { fit: "contain", background: "#111" }).toBuffer(), left: x, top: y + CAP });
    const v = c.mcq ? (c.mcq.pass ? "M✓" : "M✗") + (c.mcq.people ? " PEOPLE" : "") : c.verify?.visible === true ? "V✓" : c.verify?.visible === false ? "V✗" : "--";
    const lines = [`${img}#${c.idx} ${v} ${c.boxProblem ?? ""}${c.rejected ? " rej:" + c.rejected : ""}${chosen ? "  ★ CHOSEN" : ""}`, ...wrap(c.label, 44)];
    const svg = `<svg width="${TILE}" height="${CAP}"><rect width="100%" height="100%" fill="#000"/>${lines.map((l, k) => `<text x="5" y="${15 + k * 16}" font-family="Helvetica" font-size="${k ? 13 : 14}" fill="${k ? "#fff" : "#ff0"}">${esc(l)}</text>`).join("")}</svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y });
  }
  await sharp({ create: { width: COLS * TILE, height: rows * (TILE + CAP), channels: 3, background: "#222" } }).composite(comps).jpeg({ quality: 80 }).toFile(path.join(dir, "sheets", `sheet-${s}.jpg`));
}
console.log(items.length, "items");
