import fs from "node:fs/promises";
import path from "node:path";
const UA = "CanYouFindItSpike/0.1 (hackathon research prototype)";
const IDS = ["c010", "c013", "c014", "c039", "c045", "c049", "c050", "c051", "c063", "c064", "c074", "c075", "c099", "c100", "c103", "c081", "c082"];
const root = path.join(process.cwd(), "spike/data");
const all = JSON.parse(await fs.readFile(path.join(root, "candidates/candidates.json"), "utf8")) as Array<{ id: string; title: string; width: number; height: number; descUrl: string; license: string; artist: string }>;
await fs.mkdir(path.join(root, "pairs"), { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const manifest = [];
for (const id of IDS) {
  const c = all.find((x) => x.id === id)!;
  manifest.push({ id, title: c.title, source: c.descUrl, license: c.license, artist: c.artist });
  const out = path.join(root, "pairs", `${id}.jpg`);
  if (await fs.stat(out).then(() => true, () => false)) continue;
  await sleep(3000);
  const width = c.width >= c.height ? 1600 : Math.round((1600 * c.width) / c.height);
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.search = new URLSearchParams({ action: "query", format: "json", titles: c.title, prop: "imageinfo", iiprop: "url", iiurlwidth: String(width) }).toString();
  const txt = await (await fetch(u, { headers: { "User-Agent": UA } })).text();
  if (!txt.startsWith("{")) { console.log("rate limited", id); await sleep(20000); continue; }
  const thumb = Object.values((JSON.parse(txt) as { query: { pages: Record<string, { imageinfo: Array<{ thumburl: string }> }> } }).query.pages)[0].imageinfo[0].thumburl;
  const res = await fetch(thumb, { headers: { "User-Agent": UA } });
  if (!res.ok) { console.log("thumb failed", id, res.status); continue; }
  await fs.writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log(id, "ok");
}
await fs.writeFile(path.join(root, "pairs/manifest.json"), JSON.stringify(manifest, null, 2));
