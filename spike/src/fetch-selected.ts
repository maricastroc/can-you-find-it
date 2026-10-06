import fs from "node:fs/promises";
import path from "node:path";

const UA = "CanYouFindItSpike/0.1 (hackathon research prototype)";
const SELECTED = [
  "c000", "c002", "c009", "c012", "c016", "c024", "c026", "c028", "c030", "c041",
  "c045", "c048", "c054", "c068", "c073", "c080", "c089", "c098", "c106", "c117",
];
const LONG_SIDE = 2560;

type Candidate = { id: string; title: string; width: number; height: number; descUrl: string; license: string; artist: string; query: string };

async function main() {
  const root = path.join(process.cwd(), "spike/data");
  const all = JSON.parse(await fs.readFile(path.join(root, "candidates/candidates.json"), "utf8")) as Candidate[];
  await fs.mkdir(path.join(root, "images"), { recursive: true });
  const manifest = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const id of SELECTED) {
    const c = all.find((x) => x.id === id)!;
    manifest.push({ id, scene: c.query, title: c.title, source: c.descUrl, license: c.license, artist: c.artist });
    const out = path.join(root, "images", `${id}.jpg`);
    if (await fs.stat(out).then(() => true, () => false)) continue;
    await sleep(4000);
    const width = c.width >= c.height ? LONG_SIDE : Math.round((LONG_SIDE * c.width) / c.height);
    const u = new URL("https://commons.wikimedia.org/w/api.php");
    u.search = new URLSearchParams({
      action: "query", format: "json", titles: c.title, prop: "imageinfo", iiprop: "url", iiurlwidth: String(width),
    }).toString();
    const txt = await (await fetch(u, { headers: { "User-Agent": UA } })).text();
    if (!txt.startsWith("{")) { console.log("API said:", txt.slice(0, 300)); await sleep(30000); continue; }
    const j = JSON.parse(txt) as {
      query: { pages: Record<string, { imageinfo: Array<{ thumburl: string }> }> };
    };
    const thumb = Object.values(j.query.pages)[0].imageinfo[0].thumburl;
    const buf = Buffer.from(await (await fetch(thumb, { headers: { "User-Agent": UA } })).arrayBuffer());
    await fs.writeFile(out, buf);
    console.log(id, (buf.length / 1024).toFixed(0) + "KB", c.license);
  }
  await fs.writeFile(path.join(root, "images/manifest.json"), JSON.stringify(manifest, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
