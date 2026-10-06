import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/hunt/config";
import type { Round } from "./types";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^(photo|found-\d{1,3})\.jpg$/;

export const isRoundId = (id: string) => ID.test(id);

function root() {
  return path.resolve(config.dataDir);
}

function roundDir(id: string) {
  if (!isRoundId(id)) throw new Error("invalid round id");
  return path.join(root(), "rounds", id);
}

export async function saveRound(round: Round): Promise<void> {
  const dir = roundDir(round.id);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `round.json.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(round, null, 2));
  await fs.rename(tmp, path.join(dir, "round.json"));
}

export async function loadRound(id: string): Promise<Round | undefined> {
  if (!isRoundId(id)) return undefined;
  try {
    return JSON.parse(await fs.readFile(path.join(roundDir(id), "round.json"), "utf8")) as Round;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

export async function writeImage(id: string, name: string, data: Buffer): Promise<void> {
  if (!FILE.test(name)) throw new Error("invalid image name");
  await fs.mkdir(roundDir(id), { recursive: true });
  await fs.writeFile(path.join(roundDir(id), name), data);
}

export async function readImage(id: string, name: string): Promise<Buffer | undefined> {
  if (!isRoundId(id) || !FILE.test(name)) return undefined;
  try {
    return await fs.readFile(path.join(roundDir(id), name));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

export async function deleteRound(id: string): Promise<void> {
  await fs.rm(roundDir(id), { recursive: true, force: true });
}

export async function appendLog(event: Record<string, unknown>): Promise<void> {
  await fs.mkdir(root(), { recursive: true });
  await fs.appendFile(path.join(root(), "fieldlog.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
}
