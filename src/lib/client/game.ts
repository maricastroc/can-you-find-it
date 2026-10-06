/**
 * The round as the player experiences it, as a pure state machine. Server
 * round updates are authoritative; the reducer only decides which screen to
 * show for them.
 */
import type { Verdict } from "@/lib/hunt/check";
import type { PublicRound } from "@/lib/rounds/types";

export type Stage = "uploading" | "looking" | "checking" | "writing";

export type Screen =
  | { name: "landing" }
  | { name: "camera"; purpose: "wide" | "found" }
  | { name: "looking"; stage: Stage; attempt?: number }
  | { name: "nothing" }
  | { name: "hunt" }
  | { name: "checking" }
  | { name: "verdict"; verdict: Exclude<Verdict, "found"> }
  | { name: "ended" }
  | { name: "error"; code: string; message: string; retry: "look" | "check" | "resume" | "home" };

export type Pending = "hint" | "reveal" | "confirm" | "feedback";

export type GameState = {
  screen: Screen;
  round?: PublicRound;
  roundId?: string;
  /** Object URLs of photos taken on this device (never re-downloaded). */
  widePreview?: string;
  foundPreview?: string;
  /** Hunt mode with the screen almost black. */
  dimmed: boolean;
  pending?: Pending;
};

export type GameAction =
  | { type: "begin" }
  | { type: "camera_cancel" }
  | { type: "wide_captured"; preview: string }
  | { type: "created"; id: string }
  | { type: "progress"; stage: Stage; attempt?: number }
  | { type: "round"; round: PublicRound }
  | { type: "failed"; code: string; message: string; during: "look" | "check" | "resume" | "action" }
  | { type: "open_found_camera" }
  | { type: "found_captured"; preview: string }
  | { type: "verdict"; verdict: Verdict; round: PublicRound }
  | { type: "pending"; what?: Pending }
  | { type: "dim"; on: boolean }
  | { type: "keep_looking" }
  | { type: "again" }
  | { type: "home" };

export const initialState: GameState = { screen: { name: "landing" }, dimmed: false };

/** Which screen a round status implies, given where the player is now. */
export function screenFor(round: PublicRound, current: Screen): Screen {
  switch (round.status) {
    case "looking":
      return current.name === "looking" ? current : { name: "looking", stage: "looking" };
    case "none":
      return { name: "nothing" };
    case "hunting":
      // Keep the player where they are while a round update lands.
      if (current.name === "verdict" || current.name === "camera" || current.name === "checking") return current;
      return { name: "hunt" };
    case "found":
    case "revealed":
      return { name: "ended" };
    case "error":
      return { name: "error", code: "internal", message: round.error ?? "Something went wrong while looking.", retry: "look" };
  }
}

export function reducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "begin":
    case "again":
      return { ...initialState, screen: { name: "camera", purpose: "wide" } };
    case "home":
      return initialState;
    case "camera_cancel":
      if (state.screen.name !== "camera") return state;
      if (state.screen.purpose === "found" && state.round) return { ...state, screen: { name: "hunt" } };
      return initialState;
    case "wide_captured":
      return { ...initialState, widePreview: action.preview, screen: { name: "looking", stage: "uploading" } };
    case "created":
      return { ...state, roundId: action.id };
    case "progress":
      if (state.screen.name !== "looking") return state;
      return { ...state, screen: { name: "looking", stage: action.stage, attempt: action.attempt } };
    case "round":
      return { ...state, round: action.round, roundId: action.round.id, pending: undefined, screen: screenFor(action.round, state.screen) };
    case "failed": {
      if (action.during === "action") return { ...state, pending: undefined };
      const retry = action.during === "check" ? "check" : action.during === "resume" ? "resume" : action.code === "bad_photo" ? "home" : "look";
      return { ...state, pending: undefined, screen: { name: "error", code: action.code, message: action.message, retry } };
    }
    case "open_found_camera":
      if (!state.round || state.round.status !== "hunting") return state;
      return { ...state, dimmed: false, screen: { name: "camera", purpose: "found" } };
    case "found_captured":
      return { ...state, foundPreview: action.preview, screen: { name: "checking" } };
    case "verdict":
      if (action.verdict === "found") return { ...state, round: action.round, screen: { name: "ended" } };
      return { ...state, round: action.round, screen: { name: "verdict", verdict: action.verdict } };
    case "pending":
      return { ...state, pending: action.what };
    case "dim":
      if (state.screen.name !== "hunt") return state;
      return { ...state, dimmed: action.on };
    case "keep_looking":
      if (!state.round || state.round.status !== "hunting") return state;
      return { ...state, screen: { name: "hunt" } };
  }
}

/** Copy for the "looking" progress, honest about what the model is doing. */
export function stageLine(stage: Stage, attempt?: number): string {
  switch (stage) {
    case "uploading":
      return "Taking it in…";
    case "looking":
      return "Looking around…";
    case "checking":
      return attempt && attempt > 1 ? "That wasn't it. Looking closer at something else…" : "Something caught my eye. Making sure it's really there…";
    case "writing":
      return "Found it. Choosing my words…";
  }
}
