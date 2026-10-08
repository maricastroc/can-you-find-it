import "server-only";
import { randomUUID } from "node:crypto";
import { config } from "@/lib/hunt/config";
import { cropFor, findTarget, spatialHint, VERIFY_SIDE, writeTexts, type EngineResult } from "@/lib/hunt/engine";
import { judgeFound, type Verdict } from "@/lib/hunt/check";
import type { Box } from "@/lib/hunt/geometry";
import { areaHint, areaRegion, boxWithin, cropRegion, normalizePhoto, pixelatedHint, revealRegion } from "@/lib/hunt/images";
import { ModelUnavailableError } from "@/lib/hunt/ollama";
import { appendLog, deleteRound, loadRound, readImage, saveRound, writeImage } from "./store";
import { MAX_HINTS, type Feedback, type PublicHint, type PublicRound, type Round } from "./types";

export type StartEvent =
  | { type: "created"; id: string }
  | { type: "progress"; stage: "looking" | "checking"; attempt?: number }
  | { type: "done"; round: PublicRound }
  | { type: "error"; code: ErrorCode; message: string; id?: string };

export type ErrorCode = "model_unavailable" | "timeout" | "bad_photo" | "not_found" | "wrong_state" | "internal";

export class RoundError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RoundError";
  }
}

const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(id, next);
  try {
    return await next;
  } finally {
    if (locks.get(id) === next) locks.delete(id);
  }
}

const writing = new Map<string, Promise<void>>();
export const TEXTS_WAIT_MS = 45_000;

const url = (id: string, kind: string) => `/api/rounds/${id}/image/${kind}`;
const secondsSince = (iso?: string) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 1000) : undefined);

export const FALLBACK_HINTS = {
  semantic: "It has been here longer than you have. Look for something you'd usually walk past.",
  concrete: "It's something you could point at with one finger.",
};

export function toPublic(r: Round): PublicRound {
  const hints: PublicHint[] = [];
  if (r.target) {
    const t = r.target;
    const texts = [t.hints.semantic || FALLBACK_HINTS.semantic, t.hints.concrete || FALLBACK_HINTS.concrete, t.hints.spatial];
    for (let level = 1; level <= Math.min(r.hintsUsed, MAX_HINTS); level++) {
      hints.push(
        level <= 3
          ? { level: level as 1 | 2 | 3, kind: "text", text: texts[level - 1] }
          : level === 4
            ? { level: 4, kind: "glimpse", text: "A blurred glimpse of what I saw.", imageUrl: url(r.id, "hint") }
            : { level: 5, kind: "area", text: "It's somewhere in the bright part of your photo.", imageUrl: url(r.id, "area") },
      );
    }
  }
  const over = r.status === "found" || r.status === "revealed" || r.status === "claimed";
  const until = r.timings.endedAt ?? r.timings.claimedAt;
  const lastFound = [...r.attempts].reverse().find((a) => a.verdict === "found");
  const region = r.target ? revealRegion(r.target.box, r.photo.width / r.photo.height) : undefined;
  return {
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    clue: r.target?.clue,
    hints,
    hintsLeft: r.target ? MAX_HINTS - Math.min(r.hintsUsed, MAX_HINTS) : 0,
    attempts: r.attempts.map((a) => ({ at: a.at, verdict: a.verdict })),
    photoUrl: r.status === "looking" || r.status === "hunting" ? url(r.id, "photo") : undefined,
    stats: over
      ? {
          seconds: r.timings.clueAt && until ? Math.round((Date.parse(until) - Date.parse(r.timings.clueAt)) / 1000) : undefined,
          hints: Math.min(r.hintsUsed, MAX_HINTS),
          attempts: r.attempts.length,
          overridden: r.feedback.some((f) => f.kind === "should_have_matched"),
          selfReported: r.selfReport !== undefined,
        }
      : undefined,
    reveal:
      over && r.target
        ? {
            label: r.target.label,
            detail: r.target.detail,
            imageUrl: url(r.id, "reveal"),
            imageAspect: (region!.w * r.photo.width) / (region!.h * r.photo.height),
            box: boxWithin(r.target.box, region!),
            photoUrl: url(r.id, "photo"),
            photoBox: r.target.box,
            photoAspect: r.photo.width / r.photo.height,
            foundPhotoUrl: lastFound ? url(r.id, lastFound.file.replace(".jpg", "")) : undefined,
          }
        : undefined,
    error: r.status === "error" ? r.error : undefined,
  };
}

function classify(e: unknown): { code: ErrorCode; message: string } {
  if (e instanceof RoundError) return { code: e.code, message: e.message };
  if (e instanceof ModelUnavailableError) return { code: "model_unavailable", message: e.message };
  if ((e as Error)?.name === "TimeoutError") return { code: "timeout", message: "The model took too long to answer." };
  return { code: "internal", message: "Something went wrong while looking." };
}

const textsReady = (r: Round) => !!r.target && (r.target.textsReady ?? !!r.target.hints.semantic);

async function writeRoundTexts(id: string, photo: Buffer): Promise<void> {
  const before = await loadRound(id);
  if (!before?.target || textsReady(before)) return;
  const t0 = Date.now();
  let texts: Awaited<ReturnType<typeof writeTexts>>["texts"];
  let error: string | undefined;
  try {
    texts = (await writeTexts(photo, before.target, { model: before.model }, before.target.lens)).texts;
  } catch (e) {
    error = String((e as Error)?.message ?? e);
  }
  await withLock(id, async () => {
    const r = await loadRound(id);
    if (!r?.target) return;
    r.target.hints.semantic = texts?.hint_semantic || FALLBACK_HINTS.semantic;
    r.target.hints.concrete = texts?.hint_concrete || FALLBACK_HINTS.concrete;
    r.target.detail = texts?.detail ?? "";
    r.target.evidence = texts?.evidence ?? "";
    r.target.textsReady = true;
    await saveRound(r);
  });
  await appendLog({ event: "texts_ready", round: id, ms: Date.now() - t0, fallback: !texts, error });
}

function scheduleTexts(id: string, photo: Buffer): Promise<void> {
  const existing = writing.get(id);
  if (existing) return existing;
  const job = writeRoundTexts(id, photo)
    .catch(() => undefined)
    .finally(() => writing.delete(id));
  writing.set(id, job);
  return job;
}

async function ensureTexts(id: string): Promise<void> {
  const r = await loadRound(id);
  if (!r?.target || textsReady(r)) return;
  const photo = await readImage(id, "photo.jpg");
  if (!photo) return;
  const job = writing.get(id) ?? scheduleTexts(id, photo);
  await Promise.race([job, new Promise((resolve) => setTimeout(resolve, TEXTS_WAIT_MS))]);
}

export async function startRound(input: Buffer, emit: (e: StartEvent) => void): Promise<void> {
  const safeEmit = (e: StartEvent) => {
    try {
      emit(e);
    } catch {
      return;
    }
  };
  let photo: Awaited<ReturnType<typeof normalizePhoto>>;
  try {
    photo = await normalizePhoto(input);
  } catch {
    safeEmit({ type: "error", code: "bad_photo", message: "That photo couldn't be read. Try taking it again." });
    return;
  }
  const round: Round = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "looking",
    model: config.model,
    photo: { width: photo.width, height: photo.height },
    hintsUsed: 0,
    attempts: [],
    feedback: [],
    timings: {},
  };
  await writeImage(round.id, "photo.jpg", photo.buffer);
  await saveRound(round);
  await appendLog({ event: "round_started", round: round.id, model: round.model, width: photo.width, height: photo.height });
  safeEmit({ type: "created", id: round.id });
  safeEmit({ type: "progress", stage: "looking" });

  const t0 = Date.now();
  let result: EngineResult;
  try {
    result = await findTarget(photo.buffer, { model: config.model }, (p) => {
      if (p.stage === "verifying") safeEmit({ type: "progress", stage: "checking", attempt: p.attempt });
    });
  } catch (e) {
    const { code, message } = classify(e);
    round.status = "error";
    round.error = message;
    await saveRound(round);
    await appendLog({ event: "round_error", round: round.id, code, message: String((e as Error)?.message ?? e) });
    safeEmit({ type: "error", code, message, id: round.id });
    return;
  }

  round.candidates = result.candidates;
  round.timings.lookingMs = Date.now() - t0;
  const chosen = result.candidates.find((c) => c.idx === result.chosen);
  if (!chosen?.box || !result.lens || !result.clue) {
    round.status = "none";
    await saveRound(round);
    await appendLog({ event: "no_target", round: round.id, lookingMs: round.timings.lookingMs, proposals: result.candidates.map((c) => c.label) });
    safeEmit({ type: "done", round: toPublic(round) });
    return;
  }
  round.target = {
    label: chosen.label,
    box: chosen.box,
    lens: result.lens,
    clue: result.clue,
    hints: { semantic: "", concrete: "", spatial: spatialHint(chosen.box) },
    detail: "",
    evidence: "",
    textsReady: false,
  };
  round.status = "hunting";
  round.timings.clueAt = new Date().toISOString();
  await saveRound(round);
  await appendLog({ event: "target_ready", round: round.id, lookingMs: round.timings.lookingMs, label: chosen.label, lens: result.lens });
  safeEmit({ type: "done", round: toPublic(round) });
  void scheduleTexts(round.id, photo.buffer);
}

async function mustLoad(id: string): Promise<Round> {
  const r = await loadRound(id);
  if (!r) throw new RoundError("not_found", "This round doesn't exist anymore.");
  return r;
}

function mustBeHunting(r: Round) {
  if (r.status !== "hunting" || !r.target) throw new RoundError("wrong_state", "This round is not in play.");
}

export async function getRound(id: string): Promise<PublicRound | undefined> {
  const r = await loadRound(id);
  return r ? toPublic(r) : undefined;
}

export async function unlockHint(id: string): Promise<PublicRound> {
  const current = await mustLoad(id);
  mustBeHunting(current);
  if (current.hintsUsed < 2) await ensureTexts(id);
  return withLock(id, async () => {
    const r = await mustLoad(id);
    mustBeHunting(r);
    if (r.hintsUsed < MAX_HINTS) {
      r.hintsUsed += 1;
      await saveRound(r);
      await appendLog({ event: "hint", round: id, level: r.hintsUsed, secondsSinceClue: secondsSince(r.timings.clueAt) });
    }
    return toPublic(r);
  });
}

const centreIn = (b: Box, region: Box) => {
  const x = b.x + b.w / 2;
  const y = b.y + b.h / 2;
  return x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h;
};

function otherLabels(r: Round): string[] {
  const target = r.target!;
  const region = revealRegion(target.box, r.photo.width / r.photo.height);
  return (r.candidates ?? []).filter((c) => c.box && c.label !== target.label && !centreIn(c.box, region)).map((c) => c.label);
}

export function checkFound(id: string, input: Buffer): Promise<{ verdict: Verdict; round: PublicRound }> {
  return withLock(id, async () => {
    const r = await mustLoad(id);
    mustBeHunting(r);
    let found: Buffer;
    try {
      found = (await normalizePhoto(input)).buffer;
    } catch {
      throw new RoundError("bad_photo", "That photo couldn't be read. Try again.");
    }
    const file = `found-${r.attempts.length + 1}.jpg`;
    await writeImage(id, file, found);
    const photo = (await readImage(id, "photo.jpg"))!;
    const { buffer: targetCrop } = await cropFor(photo, r.target!.box, "verify", VERIFY_SIDE);
    const check = await judgeFound(targetCrop, found, r.target!.label, otherLabels(r), { model: r.model });
    r.attempts.push({ at: new Date().toISOString(), verdict: check.verdict, shows: check.shows, ms: check.ms, file });
    if (check.verdict === "found") {
      r.status = "found";
      r.timings.endedAt = new Date().toISOString();
    }
    await saveRound(r);
    await appendLog({
      event: "check",
      round: id,
      attempt: r.attempts.length,
      verdict: check.verdict,
      shows: check.shows,
      details: check.details,
      ms: check.ms,
      hintsUsed: r.hintsUsed,
      secondsSinceClue: secondsSince(r.timings.clueAt),
    });
    return { verdict: check.verdict, round: toPublic(r) };
  });
}

export function confirmFound(id: string): Promise<PublicRound> {
  return withLock(id, async () => {
    const r = await mustLoad(id);
    mustBeHunting(r);
    const last = r.attempts.at(-1);
    if (!last) throw new RoundError("wrong_state", "Take a photo of it first.");
    last.verdict = "found";
    r.status = "found";
    r.timings.endedAt = new Date().toISOString();
    r.feedback.push({ at: new Date().toISOString(), kind: "should_have_matched" });
    await saveRound(r);
    await appendLog({ event: "player_override", round: id, attempt: r.attempts.length, secondsSinceClue: secondsSince(r.timings.clueAt) });
    return toPublic(r);
  });
}

export function claimSeen(id: string): Promise<PublicRound> {
  return withLock(id, async () => {
    const r = await mustLoad(id);
    mustBeHunting(r);
    r.status = "claimed";
    r.timings.claimedAt = new Date().toISOString();
    await saveRound(r);
    await appendLog({ event: "claimed_seen", round: id, hintsUsed: r.hintsUsed, attempts: r.attempts.length, secondsSinceClue: secondsSince(r.timings.clueAt) });
    return toPublic(r);
  });
}

export function settleClaim(id: string, sawIt: boolean): Promise<PublicRound> {
  return withLock(id, async () => {
    const r = await mustLoad(id);
    if (r.status !== "claimed") throw new RoundError("wrong_state", "There is nothing to confirm in this round.");
    r.status = sawIt ? "found" : "revealed";
    r.selfReport = sawIt ? "saw_it" : "not_it";
    r.timings.endedAt = new Date().toISOString();
    await saveRound(r);
    await appendLog({ event: "self_report", round: id, sawIt, hintsUsed: r.hintsUsed, secondsSinceClue: secondsSince(r.timings.clueAt) });
    return toPublic(r);
  });
}

export function revealRound(id: string): Promise<PublicRound> {
  return withLock(id, async () => {
    const r = await mustLoad(id);
    mustBeHunting(r);
    r.status = "revealed";
    r.timings.endedAt = new Date().toISOString();
    await saveRound(r);
    await appendLog({ event: "gave_up", round: id, hintsUsed: r.hintsUsed, attempts: r.attempts.length, secondsSinceClue: secondsSince(r.timings.clueAt) });
    return toPublic(r);
  });
}

export function addFeedback(id: string, fb: Omit<Feedback, "at">): Promise<PublicRound> {
  return withLock(id, async () => {
    const r = await mustLoad(id);
    r.feedback.push({ ...fb, at: new Date().toISOString() });
    await saveRound(r);
    await appendLog({ event: "feedback", round: id, kind: fb.kind, note: fb.note, label: r.target?.label });
    return toPublic(r);
  });
}

export async function getRoundImage(id: string, kind: string): Promise<Buffer | undefined> {
  const r = await loadRound(id);
  if (!r) return undefined;
  const over = r.status === "found" || r.status === "revealed" || r.status === "claimed" || r.status === "none";
  const photo = await readImage(id, "photo.jpg");
  if (!photo) return undefined;
  if (kind === "photo") return photo;
  if (/^found-\d{1,3}$/.test(kind)) return readImage(id, `${kind}.jpg`);
  if (!r.target) return undefined;
  const region = revealRegion(r.target.box, r.photo.width / r.photo.height);
  if (kind === "reveal") return over ? cropRegion(photo, region, 1400) : undefined;
  if (kind === "hint") return r.hintsUsed >= 4 || over ? pixelatedHint(photo, region) : undefined;
  if (kind === "area") return r.hintsUsed >= 5 || over ? areaHint(photo, areaRegion(r.target.box, r.photo.width / r.photo.height, r.id)) : undefined;
  return undefined;
}

export function forgetRound(id: string): Promise<void> {
  return withLock(id, async () => {
    const r = await loadRound(id);
    if (!r) throw new RoundError("not_found", "This round doesn't exist anymore.");
    await deleteRound(id);
    await appendLog({ event: "forgotten", round: id });
  });
}

export async function settleTexts(id: string): Promise<void> {
  await writing.get(id);
}
