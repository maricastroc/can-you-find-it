import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicRound } from "@/lib/rounds/types";

vi.mock("@/lib/client/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/client/api")>();
  return {
    ...real,
    startRound: vi.fn(),
    getRound: vi.fn(),
    unlockHint: vi.fn(),
    checkFound: vi.fn(),
    confirmFound: vi.fn(),
    revealRound: vi.fn(),
    sendFeedback: vi.fn(),
    forgetRound: vi.fn(),
    claimSeen: vi.fn(),
    settleSeen: vi.fn(),
    warmUp: vi.fn(),
  };
});

import * as api from "@/lib/client/api";
import { Game } from "./Game";

const round = (over: Partial<PublicRound> = {}): PublicRound => ({
  id: "11111111-1111-1111-1111-111111111111",
  status: "hunting",
  createdAt: "2026-10-05T00:00:00Z",
  clue: "It only does its job after dark.",
  hints: [],
  hintsLeft: 5,
  attempts: [],
  ...over,
});

const revealed = (status: "found" | "revealed" | "claimed", selfReported = false) =>
  round({
    status,
    reveal: {
      label: "black iron lamp post",
      detail: "The lantern has four glass panes.",
      imageUrl: "/api/rounds/x/image/reveal",
      imageAspect: 1,
      box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
      photoUrl: "/api/rounds/x/image/photo",
      photoBox: { x: 0.1, y: 0.5, w: 0.05, h: 0.1 },
      photoAspect: 1.5,
    },
    stats: { seconds: 240, hints: 2, attempts: 1, overridden: false, selfReported },
  });

const KEY = "cyfi:rounds";
const storeIds = (...ids: string[]) => window.localStorage.setItem(KEY, JSON.stringify(ids));
const storedIds = (): string[] => JSON.parse(window.localStorage.getItem(KEY) ?? "[]");

async function openHunt(r: PublicRound = round()) {
  vi.mocked(api.getRound).mockResolvedValue(r);
  storeIds(r.id);
  const utils = render(<Game nativeCamera />);
  fireEvent.click(await screen.findByRole("button", { name: /It only does its job after dark/ }));
  return utils;
}

async function takePhoto(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] } });
  });
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  window.localStorage.clear();
  window.history.replaceState(null, "");
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Game", () => {
  it("plays a round: choose a place → clue → hint → check with a photo", async () => {
    vi.mocked(api.startRound).mockImplementation(async (_photo, onEvent) => {
      onEvent({ type: "created", id: round().id });
      onEvent({ type: "progress", stage: "checking", attempt: 1 });
      onEvent({ type: "done", round: round() });
    });
    vi.mocked(api.unlockHint).mockResolvedValue(round({ hints: [{ level: 1, kind: "text", text: "It helps people find their way at night." }], hintsLeft: 4 }));
    vi.mocked(api.checkFound).mockResolvedValue({ verdict: "found", round: revealed("found") });

    const { container } = render(<Game nativeCamera />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a place" }));
    await takePhoto(container);

    expect(await screen.findByRole("heading", { name: "It only does its job after dark." })).toBeInTheDocument();
    expect(storedIds()).toEqual([round().id]);

    fireEvent.click(screen.getByRole("button", { name: "Hint, 5 left" }));
    expect(await screen.findByText("It helps people find their way at night.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hint, 4 left" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check it with a photo" }));
    await takePhoto(container);
    expect(await screen.findByRole("heading", { level: 1, name: "You found it." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "The part of your photo I chose: black iron lamp post" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "The photo you took when you found it" })).toBeInTheDocument();
    expect(screen.getByText("4 min 0 s · 2 hints")).toBeInTheDocument();
    await waitFor(() => expect(storedIds()).toEqual([]));
  });

  it("the place comes from the photo library, not a live camera", async () => {
    const { container } = render(<Game />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a place" }));
    expect(await screen.findByRole("button", { name: "Take or choose a photo" })).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).not.toHaveAttribute("capture");
  });

  it("saying you saw it shows the answer, and you decide whether it was it", async () => {
    vi.mocked(api.claimSeen).mockResolvedValue(revealed("claimed"));
    vi.mocked(api.settleSeen).mockResolvedValue(revealed("found", true));
    await openHunt();
    fireEvent.click(screen.getByRole("button", { name: "I saw it, no photo" }));
    expect(api.claimSeen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show me what it was" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Is this what you saw?" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Your wide photo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "That was a good one" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yes, that's what I saw" }));
    expect(await screen.findByRole("heading", { level: 1, name: "You found it." })).toBeInTheDocument();
    expect(api.settleSeen).toHaveBeenCalledWith(round().id, true);
    expect(screen.queryByRole("button", { name: "It wasn't actually this" })).toBeNull();
  });

  it("if it wasn't what you saw, the round ends honestly", async () => {
    vi.mocked(api.claimSeen).mockResolvedValue(revealed("claimed"));
    vi.mocked(api.settleSeen).mockResolvedValue(revealed("revealed", true));
    await openHunt();
    fireEvent.click(screen.getByRole("button", { name: "I saw it, no photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Show me what it was" }));
    fireEvent.click(await screen.findByRole("button", { name: "No, I saw something else" }));
    expect(await screen.findByRole("heading", { level: 1, name: "It was this." })).toBeInTheDocument();
    expect(api.settleSeen).toHaveBeenCalledWith(round().id, false);
  });

  it("lists every open hunt, including one waiting for an answer", async () => {
    const other = round({ id: "22222222-2222-2222-2222-222222222222", clue: "Somebody takes care of this, every single week." });
    const waiting = { ...revealed("claimed"), id: "33333333-3333-3333-3333-333333333333", clue: "It decides who gets in." };
    storeIds(round().id, other.id, waiting.id);
    vi.mocked(api.getRound).mockImplementation(async (id) => [round({ hints: [{ level: 1, kind: "text", text: "Look for light." }], hintsLeft: 4 }), other, waiting].find((r) => r.id === id)!);
    render(<Game nativeCamera />);
    expect(await screen.findByRole("button", { name: /It only does its job after dark.*1 hint/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /every single week/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /It decides who gets in.*Waiting for your answer/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /It only does its job after dark/ }));
    expect(await screen.findByText("Look for light.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Your hunts" }));
    expect(await screen.findByRole("button", { name: "Another place" })).toBeInTheDocument();
  });

  it("forgets stored rounds that are already over or gone", async () => {
    storeIds(round().id, "44444444-4444-4444-4444-444444444444");
    vi.mocked(api.getRound).mockImplementation(async (id) => {
      if (id === round().id) return revealed("revealed");
      throw new api.ApiError("not_found", "gone", 404);
    });
    render(<Game nativeCamera />);
    await waitFor(() => expect(storedIds()).toEqual([]));
    expect(screen.getByRole("button", { name: "Choose a place" })).toBeInTheDocument();
  });

  it("wakes the model whenever a new photo is about to be chosen", async () => {
    vi.mocked(api.startRound).mockImplementation(async (_photo, onEvent) => {
      onEvent({ type: "created", id: round().id });
      onEvent({ type: "done", round: round({ status: "none", clue: undefined }) });
    });
    const { container } = render(<Game nativeCamera />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a place" }));
    expect(api.warmUp).toHaveBeenCalledTimes(1);
    await takePhoto(container);
    fireEvent.click(await screen.findByRole("button", { name: "Another place" }));
    expect(api.warmUp).toHaveBeenCalledTimes(2);
  });

  it("the player can look at their photo again while hunting", async () => {
    await openHunt(round({ photoUrl: "/api/rounds/x/image/photo" }));
    fireEvent.click(screen.getByRole("button", { name: "My photo" }));
    const view = screen.getByRole("dialog", { name: "Your photo" });
    expect(within(view).getByRole("img", { name: "Your photo of this place" })).toHaveAttribute("src", "/api/rounds/x/image/photo");
    expect(within(view).getByRole("button", { name: "Back to the hunt" })).toHaveFocus();
    fireEvent.click(within(view).getByRole("button", { name: "Back to the hunt" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Check it with a photo" })).toBeInTheDocument();
  });

  it("the phone's back button closes the photo instead of leaving the game", async () => {
    await openHunt(round({ photoUrl: "/api/rounds/x/image/photo" }));
    fireEvent.click(screen.getByRole("button", { name: "My photo" }));
    expect(screen.getByRole("dialog", { name: "Your photo" })).toBeInTheDocument();
    await act(async () => {
      window.history.back();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows honest progress while the model looks", async () => {
    let finish: () => void = () => undefined;
    vi.mocked(api.startRound).mockImplementation(
      (_photo, onEvent) =>
        new Promise<void>((resolve) => {
          onEvent({ type: "created", id: round().id });
          onEvent({ type: "progress", stage: "checking", attempt: 2 });
          finish = () => {
            onEvent({ type: "done", round: round() });
            resolve();
          };
        }),
    );
    const { container } = render(<Game nativeCamera />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a place" }));
    await takePhoto(container);
    expect(screen.getByRole("status")).toHaveTextContent("That wasn't it. Looking closer at something else…");
    expect(container.querySelector(".looking-photo")).toHaveAttribute("src", "blob:preview");
    await act(async () => finish());
    expect(await screen.findByRole("heading", { name: "It only does its job after dark." })).toBeInTheDocument();
  });

  it("says so when there is nothing worth hunting", async () => {
    vi.mocked(api.startRound).mockImplementation(async (_p, onEvent) => {
      onEvent({ type: "created", id: round().id });
      onEvent({ type: "done", round: round({ status: "none", clue: undefined }) });
    });
    const { container } = render(<Game nativeCamera />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a place" }));
    await takePhoto(container);
    expect(await screen.findByText("I couldn't find anything I'd trust here.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Another place" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("explains a missing model and lets the player retry", async () => {
    vi.mocked(api.startRound).mockImplementation(async (_p, onEvent) => {
      onEvent({ type: "error", code: "model_unavailable", message: "The local model is not reachable. Is Ollama running?" });
    });
    const { container } = render(<Game nativeCamera />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a place" }));
    await takePhoto(container);
    expect(await screen.findByRole("alert")).toHaveTextContent("Is Ollama running?");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("explains a lost connection", async () => {
    vi.mocked(api.startRound).mockRejectedValue(new api.ApiError("offline", "Can't reach the computer running the game."));
    const { container } = render(<Game nativeCamera />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a place" }));
    await takePhoto(container);
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the computer running the game.");
  });

  it("NOT QUITE keeps the secret and lets the player keep looking or insist", async () => {
    vi.mocked(api.checkFound).mockResolvedValue({ verdict: "not_quite", round: round({ attempts: [{ at: "t", verdict: "not_quite" }] }) });
    vi.mocked(api.confirmFound).mockResolvedValue(revealed("found"));
    const { container } = await openHunt();
    fireEvent.click(screen.getByRole("button", { name: "Check it with a photo" }));
    await takePhoto(container);
    expect(await screen.findByRole("status")).toHaveTextContent("Not quite.");
    expect(screen.queryByText(/lamp post/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I'm sure it's this one" }));
    expect(await screen.findByRole("img", { name: /The part of your photo I chose/ })).toBeInTheDocument();
  });

  it("giving up reveals what the AI saw", async () => {
    vi.mocked(api.revealRound).mockResolvedValue(revealed("revealed"));
    await openHunt();
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    expect(api.revealRound).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show me the answer" }));
    expect(await screen.findByRole("status")).toHaveTextContent("It was this.");
    expect(screen.getByText("The lantern has four glass panes.", { exact: false })).toBeInTheDocument();
  });

  it("feedback chips toggle once and reach the server", async () => {
    vi.mocked(api.revealRound).mockResolvedValue(revealed("revealed"));
    vi.mocked(api.sendFeedback).mockResolvedValue(revealed("revealed"));
    await openHunt();
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    fireEvent.click(screen.getByRole("button", { name: "Show me the answer" }));
    const chip = await screen.findByRole("button", { name: "The AI got this wrong" });
    fireEvent.click(chip);
    fireEvent.click(chip);
    await waitFor(() => expect(chip).toHaveAttribute("aria-pressed", "true"));
    expect(api.sendFeedback).toHaveBeenCalledTimes(1);
    expect(api.sendFeedback).toHaveBeenCalledWith(round().id, "target_wrong", undefined);
  });

  it("a field note is saved with the round", async () => {
    vi.mocked(api.revealRound).mockResolvedValue(revealed("revealed"));
    vi.mocked(api.sendFeedback).mockResolvedValue(revealed("revealed"));
    await openHunt();
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    fireEvent.click(screen.getByRole("button", { name: "Show me the answer" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add a field note" }));
    fireEvent.change(screen.getByLabelText("Field note"), { target: { value: "  It was behind a parked van.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByText("Noted in the field log.")).toBeInTheDocument();
    expect(api.sendFeedback).toHaveBeenCalledWith(round().id, "note", "It was behind a parked van.");
  });

  it("forgetting a place deletes it and goes home", async () => {
    vi.mocked(api.revealRound).mockResolvedValue(revealed("revealed"));
    vi.mocked(api.forgetRound).mockResolvedValue();
    await openHunt();
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    fireEvent.click(screen.getByRole("button", { name: "Show me the answer" }));
    fireEvent.click(await screen.findByRole("button", { name: "Forget this place" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this round's photos" }));
    expect(await screen.findByRole("button", { name: "Choose a place" })).toBeInTheDocument();
    expect(api.forgetRound).toHaveBeenCalledWith(round().id);
    expect(storedIds()).toEqual([]);
  });

  describe("asking for a hint", () => {
    async function hunting() {
      await openHunt();
      return screen.getByRole("button", { name: "Hint, 5 left" });
    }

    it("shows that a hint is coming right away, then the hint", async () => {
      let answer: (r: PublicRound) => void = () => undefined;
      vi.mocked(api.unlockHint).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
      fireEvent.click(await hunting());
      expect(await screen.findByText("Getting a hint…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Hint, 5 left" })).toBeDisabled();
      await act(async () => answer(round({ hints: [{ level: 1, kind: "text", text: "It helps people find their way at night." }], hintsLeft: 4 })));
      expect(screen.getByText("It helps people find their way at night.")).toBeInTheDocument();
      expect(screen.queryByText("Getting a hint…")).not.toBeInTheDocument();
    });

    it("says so when the hint can't be fetched, and lets the player try again", async () => {
      vi.mocked(api.unlockHint).mockRejectedValueOnce(new api.ApiError("offline", "Can't reach the computer running the game. Are you on the same network?"));
      fireEvent.click(await hunting());
      expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the computer running the game.");
      expect(screen.getByRole("button", { name: "Hint, 5 left" })).toBeEnabled();
    });

    it("a round the computer no longer has leads to a clear way out", async () => {
      vi.mocked(api.unlockHint).mockRejectedValueOnce(new api.ApiError("not_found", "This round doesn't exist anymore.", 404));
      fireEvent.click(await hunting());
      expect(await screen.findByRole("alert")).toHaveTextContent("This round isn't on the computer anymore.");
      vi.mocked(api.getRound).mockRejectedValue(new api.ApiError("not_found", "gone", 404));
      fireEvent.click(screen.getByRole("button", { name: "Start over" }));
      expect(await screen.findByRole("button", { name: "Choose a place" })).toBeInTheDocument();
      await waitFor(() => expect(storedIds()).toEqual([]));
    });

    it("a round that ended elsewhere is reloaded instead of failing", async () => {
      vi.mocked(api.unlockHint).mockRejectedValueOnce(new api.ApiError("wrong_state", "This round is not in play.", 409));
      const button = await hunting();
      vi.mocked(api.getRound).mockResolvedValue(revealed("revealed"));
      fireEvent.click(button);
      expect(await screen.findByRole("status")).toHaveTextContent("It was this.");
    });
  });
});
