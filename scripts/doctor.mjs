#!/usr/bin/env node
/**
 * Field-test check: is the local model ready, and how does a phone reach this
 * computer? Prints the URLs (and a QR code) to open on the phone.
 *   npm run doctor
 */
import os from "node:os";
import fs from "node:fs";
import qrcode from "qrcode-terminal";

const OLLAMA = process.env.HUNT_OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.HUNT_MODEL ?? "gemma4:e4b";
const PORT = Number(process.env.PORT ?? 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 3443);
const ok = (s) => `\u001b[32m✓\u001b[0m ${s}`;
const bad = (s) => `\u001b[31m✗\u001b[0m ${s}`;

let ready = true;
try {
  const tags = await (await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) })).json();
  console.log(ok(`Ollama is running at ${OLLAMA}`));
  const names = (tags.models ?? []).map((m) => m.name);
  if (names.includes(MODEL) || names.includes(`${MODEL}:latest`)) console.log(ok(`Model ${MODEL} is installed`));
  else {
    ready = false;
    console.log(bad(`Model ${MODEL} is not installed. Run: ollama pull ${MODEL}`));
  }
} catch {
  ready = false;
  console.log(bad(`Ollama is not reachable at ${OLLAMA}. Start it with: ollama serve`));
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
