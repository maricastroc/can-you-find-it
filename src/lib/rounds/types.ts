import type { Box } from "@/lib/hunt/geometry";
import type { Verdict } from "@/lib/hunt/check";
import type { EngineCandidate } from "@/lib/hunt/engine";
import type { LensId } from "@/lib/hunt/prompts";

export type RoundStatus =
  | "looking"
  | "none"
  | "hunting"
  | "found"
  | "revealed"
  | "error";

export type HintLevel = 1 | 2 | 3 | 4 | 5;
export const MAX_HINTS = 5;

export type Attempt = { at: string; verdict: Verdict; shows: string; ms: number; file: string };

export type Feedback = {
  at: string;
  kind: "target_wrong" | "box_wrong" | "should_have_matched" | "should_not_have_matched" | "great_moment" | "note";
  note?: string;
};

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
    textsReady?: boolean;
  };
  candidates?: EngineCandidate[];
  hintsUsed: number;
  attempts: Attempt[];
  feedback: Feedback[];
  timings: { lookingMs?: number; clueAt?: string; endedAt?: string };
  error?: string;
};

export type PublicHint =
  | { level: HintLevel; kind: "text"; text: string }
  | { level: HintLevel; kind: "glimpse" | "area"; text: string; imageUrl: string };

export type PublicRound = {
  id: string;
  status: RoundStatus;
  createdAt: string;
  clue?: string;
  hints: PublicHint[];
  hintsLeft: number;
  attempts: Array<{ at: string; verdict: Verdict }>;
  photoUrl?: string;
  stats?: { seconds?: number; hints: number; attempts: number; overridden: boolean };
  reveal?: {
    label: string;
    detail: string;
    imageUrl: string;
    imageAspect: number;
    box: Box;
    photoUrl: string;
    photoBox: Box;
    photoAspect: number;
    foundPhotoUrl?: string;
  };
  error?: string;
};
