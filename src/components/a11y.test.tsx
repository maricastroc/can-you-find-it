import axe from "axe-core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Landing } from "./screens/Landing";
import { Checking, Looking } from "./screens/Looking";
import { Hunt } from "./screens/Hunt";
import { Verdict } from "./screens/Verdict";
import { Reveal } from "./screens/Reveal";
import { ErrorScreen, Nothing } from "./screens/Messages";
import { Camera } from "./Camera";
import type { PublicRound } from "@/lib/rounds/types";

afterEach(() => cleanup());

const round: PublicRound = {
  id: "r",
  status: "hunting",
  createdAt: "t",
  clue: "It only does its job after dark.",
  hints: [
    { level: 1, kind: "text", text: "It helps at night." },
    { level: 4, kind: "glimpse", text: "A blurred glimpse of what I saw.", imageUrl: "/x.jpg" },
    { level: 5, kind: "area", text: "It's somewhere in the bright part of your photo.", imageUrl: "/y.jpg" },
  ],
  hintsLeft: 0,
  attempts: [],
};

const ended = (status: "found" | "revealed" | "claimed"): PublicRound => ({
  ...round,
  status,
  stats: { seconds: 75, hints: 1, attempts: 1, overridden: false, selfReported: false },
  reveal: {
    label: "black iron lamp post",
    detail: "Four glass panes.",
    imageUrl: "/r.jpg",
    imageAspect: 0.8,
    box: { x: 0.3, y: 0.3, w: 0.2, h: 0.4 },
    photoUrl: "/p.jpg",
    photoBox: { x: 0.1, y: 0.1, w: 0.05, h: 0.1 },
    photoAspect: 1.33,
  },
});

async function audit(ui: React.ReactElement) {
  const { container } = render(<main>{ui}</main>);
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}

const noop = () => undefined;

describe("accessibility (axe)", () => {
  it.each([
    ["landing", <Landing key="l" hunts={[]} onBegin={noop} onOpen={noop} />],
    ["landing with hunts", <Landing key="lh" hunts={[round, ended("claimed")]} onBegin={noop} onOpen={noop} />],
    ["looking", <Looking key="lo" photo="/p.jpg" stage="checking" attempt={1} />],
    ["checking", <Checking key="c" photo="/p.jpg" />],
    ["hunt", <Hunt key="h" round={round} photo="/p.jpg" onSaw={noop} onFound={noop} onHint={noop} onGiveUp={noop} onHome={noop} />],
    ["verdict", <Verdict key="v" verdict="almost" hintsLeft={2} onKeepLooking={noop} onHint={noop} onInsist={noop} />],
    ["reveal (found)", <Reveal key="rf" round={ended("found")} foundPreview="/f.jpg" onSettle={noop} onAgain={noop} onHome={noop} onFeedback={async () => undefined} onForget={async () => undefined} />],
    ["reveal (gave up)", <Reveal key="rg" round={ended("revealed")} onSettle={noop} onAgain={noop} onHome={noop} onFeedback={async () => undefined} onForget={async () => undefined} />],
    ["reveal (is this what you saw?)", <Reveal key="rc" round={ended("claimed")} onSettle={noop} onAgain={noop} onHome={noop} onFeedback={async () => undefined} onForget={async () => undefined} />],
    ["nothing", <Nothing key="n" onAgain={noop} />],
    ["error", <ErrorScreen key="e" code="model_unavailable" message="The model isn't running." retry="look" onRetry={noop} />],
  ])("%s has no violations", async (_name, ui) => {
    expect(await audit(ui)).toEqual([]);
  });

  it("camera has no violations", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
    expect(await audit(<Camera purpose="wide" onCapture={noop} onCancel={noop} native />)).toEqual([]);
  });
});
