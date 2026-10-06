import { describe, expect, it } from "vitest";
import { initialState, reducer, screenFor, stageLine, type GameAction, type GameState } from "./game";
import type { PublicRound } from "@/lib/rounds/types";

const round = (over: Partial<PublicRound> = {}): PublicRound => ({
  id: "r1",
  status: "hunting",
  createdAt: "2026-10-05T00:00:00Z",
  clue: "It only does its job after dark.",
  hints: [],
  hintsLeft: 4,
  attempts: [],
  ...over,
});

const run = (actions: GameAction[], from: GameState = initialState) => actions.reduce(reducer, from);

describe("a round from the player's side", () => {
  it("landing → camera → looking → hunt", () => {
    let s = run([{ type: "begin" }]);
    expect(s.screen).toEqual({ name: "camera", purpose: "wide" });
    s = run([{ type: "wide_captured", preview: "blob:1" }, { type: "created", id: "r1" }, { type: "progress", stage: "checking", attempt: 1 }], s);
    expect(s.screen).toEqual({ name: "looking", stage: "checking", attempt: 1 });
    expect(s.roundId).toBe("r1");
    s = reducer(s, { type: "round", round: round() });
    expect(s.screen).toEqual({ name: "hunt" });
    expect(s.widePreview).toBe("blob:1");
  });

  it("nothing to hunt → nothing screen → look again resets", () => {
    const s = run([{ type: "begin" }, { type: "wide_captured", preview: "p" }, { type: "round", round: round({ status: "none" }) }]);
    expect(s.screen.name).toBe("nothing");
    expect(reducer(s, { type: "again" }).screen).toEqual({ name: "camera", purpose: "wide" });
  });

  it("found photo → checking → verdict → keep looking", () => {
    const hunting = run([{ type: "round", round: round() }]);
    let s = run([{ type: "open_found_camera" }, { type: "found_captured", preview: "f" }], hunting);
    expect(s.screen.name).toBe("checking");
    s = reducer(s, { type: "verdict", verdict: "almost", round: round({ attempts: [{ at: "t", verdict: "almost" }] }) });
    expect(s.screen).toEqual({ name: "verdict", verdict: "almost" });
    expect(reducer(s, { type: "keep_looking" }).screen).toEqual({ name: "hunt" });
  });

  it("a found verdict ends the round", () => {
    const s = run([{ type: "round", round: round() }, { type: "verdict", verdict: "found", round: round({ status: "found" }) }]);
    expect(s.screen).toEqual({ name: "ended" });
  });

  it("giving up ends the round", () => {
    const s = run([{ type: "round", round: round() }, { type: "round", round: round({ status: "revealed" }) }]);
    expect(s.screen).toEqual({ name: "ended" });
  });

  it("a late round update doesn't yank the player out of the camera", () => {
    const s = run([{ type: "round", round: round() }, { type: "open_found_camera" }, { type: "round", round: round({ hintsLeft: 3 }) }]);
    expect(s.screen).toEqual({ name: "camera", purpose: "found" });
  });

  it("cancelling the found camera returns to the hunt, cancelling the wide one goes home", () => {
    const hunt = run([{ type: "round", round: round() }, { type: "open_found_camera" }, { type: "camera_cancel" }]);
    expect(hunt.screen).toEqual({ name: "hunt" });
    expect(run([{ type: "begin" }, { type: "camera_cancel" }]).screen).toEqual({ name: "landing" });
  });

  it("dimming only happens during the hunt and is cleared when opening the camera", () => {
    expect(reducer(initialState, { type: "dim", on: true }).dimmed).toBe(false);
    const dim = run([{ type: "round", round: round() }, { type: "dim", on: true }]);
    expect(dim.dimmed).toBe(true);
    expect(reducer(dim, { type: "open_found_camera" }).dimmed).toBe(false);
  });

  it("the found camera can't open once the round is over", () => {
    const s = run([{ type: "round", round: round({ status: "found" }) }, { type: "open_found_camera" }]);
    expect(s.screen).toEqual({ name: "ended" });
  });
});

describe("errors", () => {
  it("a failed look offers to try again", () => {
    const s = run([{ type: "begin" }, { type: "wide_captured", preview: "p" }, { type: "failed", code: "model_unavailable", message: "Is Ollama running?", during: "look" }]);
    expect(s.screen).toEqual({ name: "error", code: "model_unavailable", message: "Is Ollama running?", retry: "look" });
  });

  it("a bad photo sends the player back home", () => {
    const s = reducer(initialState, { type: "failed", code: "bad_photo", message: "x", during: "look" });
    expect(s.screen).toMatchObject({ retry: "home" });
  });

  it("a failed check retries the photo, not the round", () => {
    const s = run([{ type: "round", round: round() }, { type: "failed", code: "timeout", message: "slow", during: "check" }]);
    expect(s.screen).toMatchObject({ name: "error", retry: "check" });
  });

  it("a failed hint/reveal only clears the pending flag", () => {
    const s = run([{ type: "round", round: round() }, { type: "pending", what: "hint" }, { type: "failed", code: "offline", message: "x", during: "action" }]);
    expect(s.screen).toEqual({ name: "hunt" });
    expect(s.pending).toBeUndefined();
  });

  it("a round that errored server-side shows an error screen", () => {
    expect(screenFor(round({ status: "error", error: "boom" }), { name: "landing" })).toMatchObject({ name: "error", message: "boom" });
  });
});

describe("resume", () => {
  it("a stored hunting round lands on the hunt", () => {
    expect(reducer(initialState, { type: "round", round: round() }).screen).toEqual({ name: "hunt" });
  });

  it("a stored round still being looked at lands on the looking screen", () => {
    expect(reducer(initialState, { type: "round", round: round({ status: "looking" }) }).screen).toEqual({ name: "looking", stage: "looking" });
  });
});

describe("stageLine", () => {
  it("is honest about retries", () => {
    expect(stageLine("checking", 1)).toMatch(/caught my eye/);
    expect(stageLine("checking", 2)).toMatch(/something else/);
  });
});
