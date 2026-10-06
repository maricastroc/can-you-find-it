import type { Box } from "@/lib/hunt/geometry";
import type { Verdict } from "@/lib/hunt/check";
import type { EngineCandidate } from "@/lib/hunt/engine";
import type { LensId } from "@/lib/hunt/prompts";

export type RoundStatus =
  | "looking" // the model is choosing a target
  | "none" // it found nothing it could verify
  | "hunting" // a clue is out; the player is searching
  | "found"
  | "revealed" // the player gave up
  | "error";

export type HintLevel = 1 | 2 | 3 | 4;
export const MAX_HINTS = 4;

export type Attempt = { at: string; verdict: Verdict; shows: string; ms: number; file: string };

export type Feedback = {
  at: string;
  kind: "target_wrong" | "box_wrong" | "should_have_matched" | "should_not_have_matched" | "great_moment" | "note";
  note?: string;
};

/** Everything the server knows. Never sent to the client as-is. */
export type Round = {
  id: string;
  createdAt: string;
  status: RoundStatus;
  model: string;
  photo: { width: number; height: number };
  target?: {
    label: string;
    box: Box;
    lens: LensId;
    clue: string;
    hints: { semantic: string; concrete: string; spatial: string };
    detail: string;
    evidence: string;
  };
  /** All proposals and their verification, for the field log. */
  candidates?: EngineCandidate[];
  hintsUsed: number;
  attempts: Attempt[];
  feedback: Feedback[];
  timings: { lookingMs?: number; clueAt?: string; endedAt?: string };
  error?: string;
};

export type PublicHint =
  | { level: HintLevel; kind: "text"; text: string }
  | { level: HintLevel; kind: "image"; imageUrl: string };

/** What the player's device may see. The target stays secret until the end. */
export type PublicRound = {
  id: string;
  status: RoundStatus;
  createdAt: string;
  clue?: string;
  hints: PublicHint[];
  hintsLeft: number;
  attempts: Array<{ at: string; verdict: Verdict }>;
  /** The wide photo, only while the model is still looking (for resume). */
  photoUrl?: string;
  /** Only once the round is over (found or revealed). */
  stats?: { seconds?: number; hints: number; attempts: number; overridden: boolean };
  reveal?: {
    label: string;
    detail: string;
    imageUrl: string;
    /** Width / height of the reveal image, so the frame can match it exactly. */
    imageAspect: number;
    /** Where the target is inside the reveal image, 0–1. */
    box: Box;
    photoUrl: string;
    /** Where the target is inside the full wide photo, 0–1. */
    photoBox: Box;
    photoAspect: number;
    foundPhotoUrl?: string;
  };
  error?: string;
};
