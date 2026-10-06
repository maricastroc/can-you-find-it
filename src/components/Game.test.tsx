import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  hintsLeft: 4,
  attempts: [],
  ...over,
});

const revealed = (status: "found" | "revealed") =>
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
    stats: { seconds: 240, hints: 2, attempts: 1, overridden: false },
  });

async function takePhoto(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] } });
  });
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Game", () => {
  it("plays a round: look → clue → hint → found it", async () => {
    vi.mocked(api.startRound).mockImplementation(async (_photo, onEvent) => {
      onEvent({ type: "created", id: round().id });
      onEvent({ type: "progress", stage: "checking", attempt: 1 });
      onEvent({ type: "done", round: round() });
    });
    vi.mocked(api.unlockHint).mockResolvedValue(round({ hints: [{ level: 1, kind: "text", text: "It helps people find their way at night." }], hintsLeft: 3 }));
    vi.mocked(api.checkFound).mockResolvedValue({ verdict: "found", round: revealed("found") });

    const { container } = render(<Game nativeCamera />);
    fireEvent.click(screen.getByRole("button", { name: "Take a look" }));
    await takePhoto(container);

    expect(await screen.findByRole("heading", { name: "It only does its job after dark." })).toBeInTheDocument();
    expect(window.localStorage.getItem("cyfi:round")).toBe(round().id);

    fireEvent.click(screen.getByRole("button", { name: "Hint, 4 left" }));
    expect(await screen.findByText("It helps people find their way at night.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hint, 3 left" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "I found it" }));
    await takePhoto(container);
    expect(await screen.findByRole("status")).toHaveTextContent("Found it.");
    expect(screen.getByRole("img", { name: "The part of your photo I chose: black iron lamp post" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "The photo you took when you found it" })).toBeInTheDocument();
    expect(screen.getByText("4 min 0 s · 2 hints")).toBeInTheDocument();
    expect(window.localStorage.getItem("cyfi:round")).toBeNull();
  });

  it("wakes the model whenever a new photo is about to be taken", async () => {
    vi.mocked(api.startRound).mockImplementation(async (_photo, onEvent) => {
      onEvent({ type: "created", id: round().id });
      onEvent({ type: "done", round: round({ status: "none", clue: undefined }) });
    });
    const { container } = render(<Game nativeCamera />);
    fireEvent.click(screen.getByRole("button", { name: "Take a look" }));
    expect(api.warmUp).toHaveBeenCalledTimes(1);
    await takePhoto(container);
    fireEvent.click(await screen.findByRole("button", { name: "Look around again" }));
    expect(api.warmUp).toHaveBeenCalledTimes(2);
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
    fireEvent.click(screen.getByRole("button", { name: "Take a look" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Take a look" }));
    await takePhoto(container);
    expect(await screen.findByText("I couldn't find anything I'd trust here.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Look around again" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("explains a missing model and lets the player retry", async () => {
    vi.mocked(api.startRound).mockImplementation(async (_p, onEvent) => {
      onEvent({ type: "error", code: "model_unavailable", message: "The local model is not reachable. Is Ollama running?" });
    });
    const { container } = render(<Game nativeCamera />);
    fireEvent.click(screen.getByRole("button", { name: "Take a look" }));
    await takePhoto(container);
    expect(await screen.findByRole("alert")).toHaveTextContent("Is Ollama running?");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("explains a lost connection", async () => {
    vi.mocked(api.startRound).mockRejectedValue(new api.ApiError("offline", "Can't reach the computer running the game."));
    const { container } = render(<Game nativeCamera />);
    fireEvent.click(screen.getByRole("button", { name: "Take a look" }));
    await takePhoto(container);
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the computer running the game.");
  });

  it("resumes a round after a reload", async () => {
    window.localStorage.setItem("cyfi:round", round().id);
    vi.mocked(api.getRound).mockResolvedValue(round({ hints: [{ level: 1, kind: "text", text: "Look for light." }], hintsLeft: 3 }));
    render(<Game nativeCamera />);
    expect(await screen.findByRole("heading", { name: "It only does its job after dark." })).toBeInTheDocument();
    expect(screen.getByText("Look for light.")).toBeInTheDocument();
  });

  it("forgets a stored round that is already over", async () => {
    window.localStorage.setItem("cyfi:round", round().id);
    vi.mocked(api.getRound).mockResolvedValue(revealed("revealed"));
    render(<Game nativeCamera />);
    await waitFor(() => expect(window.localStorage.getItem("cyfi:round")).toBeNull());
    expect(screen.getByRole("button", { name: "Take a look" })).toBeInTheDocument();
  });

  it("NOT QUITE keeps the secret and lets the player keep looking or insist", async () => {
    vi.mocked(api.getRound).mockResolvedValue(round());
    window.localStorage.setItem("cyfi:round", round().id);
    vi.mocked(api.checkFound).mockResolvedValue({ verdict: "not_quite", round: round({ attempts: [{ at: "t", verdict: "not_quite" }] }) });
    vi.mocked(api.confirmFound).mockResolvedValue(revealed("found"));
    const { container } = render(<Game nativeCamera />);
    fireEvent.click(await screen.findByRole("button", { name: "I found it" }));
    await takePhoto(container);
    expect(await screen.findByRole("status")).toHaveTextContent("Not quite.");
    expect(screen.queryByText(/lamp post/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I'm sure it's this one" }));
    expect(await screen.findByRole("img", { name: /The part of your photo I chose/ })).toBeInTheDocument();
  });

  it("giving up reveals what the AI saw", async () => {
    vi.mocked(api.getRound).mockResolvedValue(round());
    window.localStorage.setItem("cyfi:round", round().id);
    vi.mocked(api.revealRound).mockResolvedValue(revealed("revealed"));
    render(<Game nativeCamera />);
    fireEvent.click(await screen.findByRole("button", { name: "Give up" }));
    expect(api.revealRound).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show me what it was" }));
    expect(await screen.findByRole("status")).toHaveTextContent("It was this.");
    expect(screen.getByText("The lantern has four glass panes.", { exact: false })).toBeInTheDocument();
  });

  it("looking up dims everything but the clue", async () => {
    vi.mocked(api.getRound).mockResolvedValue(round());
    window.localStorage.setItem("cyfi:round", round().id);
    render(<Game nativeCamera />);
    fireEvent.click(await screen.findByRole("button", { name: "Look up" }));
    const wake = screen.getByRole("button", { name: /Tap to wake the screen/ });
    expect(wake).toHaveTextContent("It only does its job after dark.");
    expect(screen.queryByRole("button", { name: "Give up" })).not.toBeInTheDocument();
    fireEvent.click(wake);
    expect(screen.getByRole("button", { name: "Give up" })).toBeInTheDocument();
  });

  it("the screen rests by itself when left alone", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(api.getRound).mockResolvedValue(round());
      window.localStorage.setItem("cyfi:round", round().id);
      render(<Game nativeCamera />);
      await screen.findByRole("button", { name: "Look up" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(screen.getByRole("button", { name: /Tap to wake the screen/ })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("feedback chips toggle once and reach the server", async () => {
    vi.mocked(api.getRound).mockResolvedValue(round());
    window.localStorage.setItem("cyfi:round", round().id);
    vi.mocked(api.revealRound).mockResolvedValue(revealed("revealed"));
    vi.mocked(api.sendFeedback).mockResolvedValue(revealed("revealed"));
    render(<Game nativeCamera />);
    fireEvent.click(await screen.findByRole("button", { name: "Give up" }));
    fireEvent.click(screen.getByRole("button", { name: "Show me what it was" }));
    const chip = await screen.findByRole("button", { name: "The AI got this wrong" });
    fireEvent.click(chip);
    fireEvent.click(chip);
    await waitFor(() => expect(chip).toHaveAttribute("aria-pressed", "true"));
    expect(api.sendFeedback).toHaveBeenCalledTimes(1);
    expect(api.sendFeedback).toHaveBeenCalledWith(round().id, "target_wrong", undefined);
  });

  it("a field note is saved with the round", async () => {
    vi.mocked(api.getRound).mockResolvedValue(round());
    window.localStorage.setItem("cyfi:round", round().id);
    vi.mocked(api.revealRound).mockResolvedValue(revealed("revealed"));
    vi.mocked(api.sendFeedback).mockResolvedValue(revealed("revealed"));
    render(<Game nativeCamera />);
    fireEvent.click(await screen.findByRole("button", { name: "Give up" }));
    fireEvent.click(screen.getByRole("button", { name: "Show me what it was" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add a field note" }));
    fireEvent.change(screen.getByLabelText("Field note"), { target: { value: "  It was behind a parked van.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByText("Noted in the field log.")).toBeInTheDocument();
    expect(api.sendFeedback).toHaveBeenCalledWith(round().id, "note", "It was behind a parked van.");
  });

  it("forgetting a place deletes it and goes home", async () => {
    vi.mocked(api.getRound).mockResolvedValue(round());
    window.localStorage.setItem("cyfi:round", round().id);
    vi.mocked(api.revealRound).mockResolvedValue(revealed("revealed"));
    vi.mocked(api.forgetRound).mockResolvedValue();
    render(<Game nativeCamera />);
    fireEvent.click(await screen.findByRole("button", { name: "Give up" }));
    fireEvent.click(screen.getByRole("button", { name: "Show me what it was" }));
    fireEvent.click(await screen.findByRole("button", { name: "Forget this place" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this round's photos" }));
    expect(await screen.findByRole("button", { name: "Take a look" })).toBeInTheDocument();
    expect(api.forgetRound).toHaveBeenCalledWith(round().id);
  });

  describe("asking for a hint", () => {
    async function hunting() {
      vi.mocked(api.getRound).mockResolvedValue(round());
      window.localStorage.setItem("cyfi:round", round().id);
      render(<Game nativeCamera />);
      return screen.findByRole("button", { name: "Hint, 4 left" });
    }

    it("shows that a hint is coming right away, then the hint", async () => {
      let answer: (r: PublicRound) => void = () => undefined;
      vi.mocked(api.unlockHint).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
      fireEvent.click(await hunting());
      expect(await screen.findByText("Getting a hint…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Hint, 4 left" })).toBeDisabled();
      await act(async () => answer(round({ hints: [{ level: 1, kind: "text", text: "It helps people find their way at night." }], hintsLeft: 3 })));
      expect(screen.getByText("It helps people find their way at night.")).toBeInTheDocument();
      expect(screen.queryByText("Getting a hint…")).not.toBeInTheDocument();
    });

    it("says so when the hint can't be fetched, and lets the player try again", async () => {
      vi.mocked(api.unlockHint).mockRejectedValueOnce(new api.ApiError("offline", "Can't reach the computer running the game. Are you on the same network?"));
      fireEvent.click(await hunting());
      expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the computer running the game.");
      expect(screen.getByRole("button", { name: "Hint, 4 left" })).toBeEnabled();
    });

    it("a round the computer no longer has leads to a clear way out", async () => {
      vi.mocked(api.unlockHint).mockRejectedValueOnce(new api.ApiError("not_found", "This round doesn't exist anymore.", 404));
      fireEvent.click(await hunting());
      expect(await screen.findByRole("alert")).toHaveTextContent("This round isn't on the computer anymore.");
      fireEvent.click(screen.getByRole("button", { name: "Start over" }));
      expect(screen.getByRole("button", { name: "Take a look" })).toBeInTheDocument();
      expect(window.localStorage.getItem("cyfi:round")).toBeNull();
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
