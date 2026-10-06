/**
 * Field notes: one row per round, built from what's on disk, for the field
 * test write-up (did the target exist, time to find, hints, false
 * positives/negatives, bad targets, great moments).
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/hunt/config";
import type { Round } from "./types";

export type NoteRow = {
  id: string;
  at: string;
  status: Round["status"];
  label?: string;
  lens?: string;
  clue?: string;
  lookingSeconds?: number;
  secondsToEnd?: number;
  hints: number;
  verdicts: string[];
  /** The player overrode a NOT QUITE: a possible false negative. */
  override: boolean;
  /** The player said the accepted photo wasn't it: a false positive. */
  flaggedFalsePositive: boolean;
  flaggedBadTarget: boolean;
  greatMoment: boolean;
  notes: string[];
  proposals: string[];
};

export function rowFor(r: Round): NoteRow {
  const kinds = new Set(r.feedback.map((f) => f.kind));
  return {
    id: r.id,
    at: r.createdAt,
    status: r.status,
    label: r.target?.label,
    lens: r.target?.lens,
    clue: r.target?.clue,
    lookingSeconds: r.timings.lookingMs !== undefined ? Math.round(r.timings.lookingMs / 1000) : undefined,
    secondsToEnd:
      r.timings.clueAt && r.timings.endedAt ? Math.round((Date.parse(r.timings.endedAt) - Date.parse(r.timings.clueAt)) / 1000) : undefined,
    hints: r.hintsUsed,
    verdicts: r.attempts.map((a) => a.verdict),
    override: kinds.has("should_have_matched"),
    flaggedFalsePositive: kinds.has("should_not_have_matched"),
    flaggedBadTarget: kinds.has("target_wrong") || kinds.has("box_wrong"),
    greatMoment: kinds.has("great_moment"),
    notes: r.feedback.filter((f) => f.kind === "note" && f.note).map((f) => f.note!),
    proposals: (r.candidates ?? []).map((c) => c.label),
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function summarize(rows: NoteRow[]) {
  const played = rows.filter((r) => r.status === "found" || r.status === "revealed");
  const found = played.filter((r) => r.status === "found");
  return {
    rounds: rows.length,
    noTarget: rows.filter((r) => r.status === "none").length,
    errors: rows.filter((r) => r.status === "error").length,
    played: played.length,
    found: found.length,
    gaveUp: played.length - found.length,
    medianLookingSeconds: median(rows.flatMap((r) => (r.lookingSeconds !== undefined ? [r.lookingSeconds] : []))),
    medianSecondsToFind: median(found.flatMap((r) => (r.secondsToEnd !== undefined ? [r.secondsToEnd] : []))),
    medianHints: median(played.map((r) => r.hints)),
    overrides: rows.filter((r) => r.override).length,
    falsePositives: rows.filter((r) => r.flaggedFalsePositive).length,
    badTargets: rows.filter((r) => r.flaggedBadTarget).length,
    greatMoments: rows.filter((r) => r.greatMoment).length,
  };
}

export async function loadRows(): Promise<NoteRow[]> {
  const dir = path.join(path.resolve(config.dataDir), "rounds");
  const ids = await fs.readdir(dir).catch(() => [] as string[]);
  const rows: NoteRow[] = [];
  for (const id of ids) {
    try {
      rows.push(rowFor(JSON.parse(await fs.readFile(path.join(dir, id, "round.json"), "utf8")) as Round));
    } catch {
      // half-written or foreign folder: skip
    }
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

const CSV_COLUMNS: Array<keyof NoteRow> = [
  "at", "status", "label", "lens", "clue", "lookingSeconds", "secondsToEnd", "hints", "verdicts",
  "override", "flaggedFalsePositive", "flaggedBadTarget", "greatMoment", "notes",
];

export function toCsv(rows: NoteRow[]): string {
  const cell = (v: unknown) => {
    const s = Array.isArray(v) ? v.join(" → ") : v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

/** Field notes are only shown on the computer running the game, not to phones on the network. */
export function isLocalHost(host: string | null): boolean {
  const name = (host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}
