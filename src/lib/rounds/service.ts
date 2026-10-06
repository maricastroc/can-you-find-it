/**
 * Round lifecycle: wide photo → secret target → hints → checks → end.
 * The target (label, box, crops) stays on the server until the round ends.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { config } from "@/lib/hunt/config";
import { chooseLens, cropFor, findTarget, spatialHint, type EngineResult } from "@/lib/hunt/engine";
import { compareWithTarget, type Verdict } from "@/lib/hunt/check";
import { boxWithin, cropRegion, normalizePhoto, pixelatedHint, revealRegion } from "@/lib/hunt/images";
import { LENS_MENU } from "@/lib/hunt/prompts";
import { ModelUnavailableError } from "@/lib/hunt/ollama";
import { appendLog, deleteRound, loadRound, readImage, saveRound, writeImage } from "./store";
import { MAX_HINTS, type Feedback, type PublicHint, type PublicRound, type Round } from "./types";

export type StartEvent =
  | { type: "created"; id: string }
  | { type: "progress"; stage: "looking" | "checking" | "writing"; attempt?: number }
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

// One mutation at a time per round (double taps, retries).
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

const url = (id: string, kind: string) => `/api/rounds/${id}/image/${kind}`;
const secondsSince = (iso?: string) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 1000) : undefined);

export function toPublic(r: Round): PublicRound {
  const hints: PublicHint[] = [];
  if (r.target) {
    const t = r.target;
    const texts = [t.hints.semantic, t.hints.concrete, t.hints.spatial];
    for (let level = 1; level <= Math.min(r.hintsUsed, MAX_HINTS); level++) {
      hints.push(
        level <= 3
          ? { level: level as 1 | 2 | 3, kind: "text", text: texts[level - 1] }
          : { level: 4, kind: "image", imageUrl: url(r.id, "hint") },
      );
    }
  }
  const over = r.status === "found" || r.status === "revealed";
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
    photoUrl: r.status === "looking" ? url(r.id, "photo") : undefined,
    stats: over
      ? {
          seconds:
            r.timings.clueAt && r.timings.endedAt ? Math.round((Date.parse(r.timings.endedAt) - Date.parse(r.timings.clueAt)) / 1000) : undefined,
          hints: Math.min(r.hintsUsed, MAX_HINTS),
          attempts: r.attempts.length,
          overridden: r.feedback.some((f) => f.kind === "should_have_matched"),
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

/** Texts used when the writer's answer can't be read; true for any target. */
function fallbackTexts(label: string, box: NonNullable<Round["target"]>["box"]) {
  const lens = chooseLens(label, undefined, box);
  return {
    lens,
    clue: LENS_MENU.find((l) => l.id === lens)!.line,
    evidence: "",
    hint_semantic: "It has been here longer than you have. Look for something you'd usually walk past.",
    hint_concrete: "It's something you could point at with one finger.",
    detail: "",
  };
}

export async function startRound(input: Buffer, emit: (e: StartEvent) => void): Promise<void> {
  const safeEmit = (e: StartEvent) => {
    try {
      emit(e);
    } catch {
      // The phone may have gone to sleep; the round still completes.
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
      if (p.stage === "chosen") safeEmit({ type: "progress", stage: "writing" });
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
  if (!chosen?.box) {
    round.status = "none";
    await saveRound(round);
    await appendLog({ event: "no_target", round: round.id, lookingMs: round.timings.lookingMs, proposals: result.candidates.map((c) => c.label) });
    safeEmit({ type: "done", round: toPublic(round) });
    return;
  }
  const texts = result.texts ?? fallbackTexts(chosen.label, chosen.box);
  round.target = {
    label: chosen.label,
    box: chosen.box,
    lens: texts.lens,
    clue: texts.clue,
    hints: { semantic: texts.hint_semantic, concrete: texts.hint_concrete, spatial: spatialHint(chosen.box) },
    detail: texts.detail,
    evidence: texts.evidence,
  };
  round.status = "hunting";
  round.timings.clueAt = new Date().toISOString();
  await saveRound(round);
  await appendLog({
    event: "target_ready",
    round: round.id,
    lookingMs: round.timings.lookingMs,
    label: chosen.label,
    lens: texts.lens,
    usedFallbackTexts: !result.texts,
  });
  safeEmit({ type: "done", round: toPublic(round) });
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

export function unlockHint(id: string): Promise<PublicRound> {
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
    const { buffer: targetCrop } = await cropFor(photo, r.target!.box, "verify");
    const check = await compareWithTarget(targetCrop, found, r.target!.label, { model: r.model });
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

/** The player is sure it's the right thing although the model disagreed. */
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

export type ImageKind = "photo" | "reveal" | "hint" | `found-${number}`;

/** Images are gated by round state so the device can't peek at the target. */
export async function getRoundImage(id: string, kind: string): Promise<Buffer | undefined> {
  const r = await loadRound(id);
  if (!r) return undefined;
  const over = r.status === "found" || r.status === "revealed" || r.status === "none";
  const photo = await readImage(id, "photo.jpg");
  if (!photo) return undefined;
  if (kind === "photo") return over || r.status === "looking" ? photo : undefined;
  if (/^found-\d{1,3}$/.test(kind)) return readImage(id, `${kind}.jpg`);
  if (!r.target) return undefined;
  const region = revealRegion(r.target.box, r.photo.width / r.photo.height);
  if (kind === "reveal") return over ? cropRegion(photo, region, 1400) : undefined;
  if (kind === "hint") return r.hintsUsed >= MAX_HINTS || over ? pixelatedHint(photo, region) : undefined;
  return undefined;
}

/** Delete the round's photos and state from this machine. The text log stays. */
export function forgetRound(id: string): Promise<void> {
  return withLock(id, async () => {
    const r = await loadRound(id);
    if (!r) throw new RoundError("not_found", "This round doesn't exist anymore.");
    await deleteRound(id);
    await appendLog({ event: "forgotten", round: id });
  });
}
