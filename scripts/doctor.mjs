import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import qrcode from "qrcode-terminal";

const OLLAMA = process.env.HUNT_OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.HUNT_MODEL ?? "gemma4:e4b";
const PORT = Number(process.env.PORT ?? 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 3443);
const MODEL_GB = 9.5;
const ok = (s) => `\u001b[32m✓\u001b[0m ${s}`;
const warn = (s) => `\u001b[33m!\u001b[0m ${s}`;
const bad = (s) => `\u001b[31m✗\u001b[0m ${s}`;

function memory() {
  if (process.platform !== "darwin") return { availableGb: os.freemem() / 1e9, swapGb: 0 };
  const swap = execFileSync("sysctl", ["-n", "vm.swapusage"], { encoding: "utf8" });
  const vm = execFileSync("vm_stat", { encoding: "utf8" });
  const page = Number(/page size of (\d+)/.exec(vm)?.[1] ?? 16384);
  const pages = (name) => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(vm)?.[1] ?? 0);
  const available = (pages("Pages free") + pages("Pages inactive") + pages("Pages purgeable")) * page;
  const used = /used = ([\d.]+)M/.exec(swap);
  return { availableGb: available / 1e9, swapGb: used ? Number(used[1]) / 1024 : 0 };
}

let ready = true;
let loaded = false;
try {
  const tags = await (await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) })).json();
  console.log(ok(`Ollama is running at ${OLLAMA}`));
  const names = (tags.models ?? []).map((m) => m.name);
  if (names.includes(MODEL) || names.includes(`${MODEL}:latest`)) console.log(ok(`Model ${MODEL} is installed`));
  else {
    ready = false;
    console.log(bad(`Model ${MODEL} is not installed. Run: ollama pull ${MODEL}`));
  }
  const ps = await (await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(3000) })).json();
  loaded = (ps.models ?? []).some((m) => m.name === MODEL || m.name === `${MODEL}:latest`);
} catch {
  ready = false;
  console.log(bad(`Ollama is not reachable at ${OLLAMA}. Start it with: ollama serve`));
}

const mem = memory();
if (mem.swapGb > 2) {
  console.log(warn(`This computer is swapping ${mem.swapGb.toFixed(1)} GB to disk. The model gets many times slower when its memory is swapped out.`));
  console.log(`  Close other apps (browsers, editors, chat and design apps) before playing${loaded ? `, then run: ollama stop ${MODEL}` : "."}`);
} else if (!loaded && mem.availableGb < MODEL_GB) {
  console.log(warn(`About ${mem.availableGb.toFixed(1)} GB of memory is free; the model needs about ${MODEL_GB} GB. Close other apps for the best speed.`));
} else {
  console.log(ok(`Memory looks fine (${mem.swapGb.toFixed(1)} GB swapped)`));
}

const addresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a.address);
if (!addresses.length) console.log(bad("No network connection. Join the same Wi-Fi as the phone, or the phone's hotspot."));

const certs = fs.existsSync("certificates/cert.pem");
for (const ip of addresses) {
  const http = `http://${ip}:${PORT}`;
  console.log(`\nOn the phone (same Wi-Fi or hotspot), open:\n  ${http}   — uses the phone's camera app`);
  if (certs) console.log(`  https://${ip}:${HTTPS_PORT}  — live camera (needs the certificate trusted on the phone)`);
  qrcode.generate(certs ? `https://${ip}:${HTTPS_PORT}` : http, { small: true });
}
console.log(ready ? "\nReady. Start the game with: npm run field" : "\nFix the items above first.");
process.exit(ready ? 0 : 1);
