/**
 * Spike helper: search Wikimedia Commons for wide outdoor photos of public
 * places and download small previews + a contact sheet so a human can pick
 * the test set. Run: npx tsx spike/src/fetch-candidates.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";

const UA = "CanYouFindItSpike/0.1 (hackathon research prototype)";
const OUT = path.join(process.cwd(), "spike/data/candidates");

const QUERIES = [
  "city park path benches autumn",
  "town square fountain people",
  "beach promenade",
  "residential street sidewalk trees",
  "botanical garden path",
  "children playground park",
  "riverside walkway",
  "forest trail hiking path",
  "old town market square",
  "park pond ducks",
  "community garden",
  "harbour pier boats",
  "alley street art graffiti",
  "village street houses",
  "university campus lawn",
  "public garden gazebo",
];

type Hit = {
  title: string;
  thumb: string;
  width: number;
  height: number;
  descUrl: string;
  license: string;
  artist: string;
};

async function search(q: string): Promise<Hit[]> {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${q} filetype:bitmap`,
    gsrlimit: "12",
    prop: "imageinfo",
    iiprop: "url|size|extmetadata|mime",
    iiurlwidth: "480",
  }).toString();
  const res = await fetch(u, { headers: { "User-Agent": UA } });
  const json = (await res.json()) as {
    query?: { pages?: Record<string, { title: string; imageinfo?: Array<Record<string, unknown>> }> };
  };
  const pages = Object.values(json.query?.pages ?? {});
  const hits: Hit[] = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0] as
      | {
          thumburl: string;
          width: number;
          height: number;
          descriptionurl: string;
          mime: string;
          extmetadata?: Record<string, { value: string }>;
        }
      | undefined;
    if (!ii || ii.mime !== "image/jpeg") continue;
    if (Math.max(ii.width, ii.height) < 2000) continue;
    const strip = (s?: string) => (s ?? "").replace(/<[^>]+>/g, "").trim();
    hits.push({
      title: p.title,
      thumb: ii.thumburl,
      width: ii.width,
      height: ii.height,
      descUrl: ii.descriptionurl,
      license: strip(ii.extmetadata?.LicenseShortName?.value),
      artist: strip(ii.extmetadata?.Artist?.value),
    });
  }
  return hits.slice(0, 8);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const all: Array<Hit & { id: string; query: string }> = [];
  let n = 0;
  for (const q of QUERIES) {
    const hits = await search(q);
    for (const h of hits) {
      const id = `c${String(n++).padStart(3, "0")}`;
      const buf = Buffer.from(await (await fetch(h.thumb, { headers: { "User-Agent": UA } })).arrayBuffer());
      await fs.writeFile(path.join(OUT, `${id}.jpg`), buf);
      all.push({ ...h, id, query: q });
    }
    console.log(`${q}: ${hits.length}`);
  }
  await fs.writeFile(path.join(OUT, "candidates.json"), JSON.stringify(all, null, 2));

  // Contact sheets: 4 columns x 4 rows of 360px tiles, labelled with id.
  const TILE = 360;
  const COLS = 4;
  const PER_SHEET = 16;
  for (let s = 0; s * PER_SHEET < all.length; s++) {
    const chunk = all.slice(s * PER_SHEET, (s + 1) * PER_SHEET);
    const rows = Math.ceil(chunk.length / COLS);
    const composites: OverlayOptions[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      const tile = await sharp(path.join(OUT, `${c.id}.jpg`)).resize(TILE, TILE, { fit: "contain", background: "#111" }).toBuffer();
      const x = (i % COLS) * TILE;
      const y = Math.floor(i / COLS) * (TILE + 28);
      composites.push({ input: tile, left: x, top: y + 28 });
      const label = Buffer.from(
        `<svg width="${TILE}" height="28"><rect width="100%" height="100%" fill="#000"/><text x="6" y="20" font-family="Helvetica" font-size="18" fill="#ff0">${c.id} · ${c.query.slice(0, 28)}</text></svg>`,
      );
      composites.push({ input: label, left: x, top: y });
    }
    await sharp({ create: { width: COLS * TILE, height: rows * (TILE + 28), channels: 3, background: "#222" } })
      .composite(composites)
      .jpeg({ quality: 80 })
      .toFile(path.join(OUT, `sheet-${s}.jpg`));
  }
  console.log(`total ${all.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
