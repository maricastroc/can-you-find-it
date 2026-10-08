import { BrandMark } from "../Mark";
import type { PublicRound } from "@/lib/rounds/types";

type Props = {
  hunts: PublicRound[];
  onBegin: () => void;
  onOpen: (round: PublicRound) => void;
};

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function status(round: PublicRound) {
  if (round.status === "claimed") return "Waiting for your answer";
  const hints = round.hints.length;
  return `Since ${day(round.createdAt)}${hints ? ` · ${hints === 1 ? "1 hint" : `${hints} hints`}` : ""}`;
}

export function Landing({ hunts, onBegin, onOpen }: Props) {
  return (
    <section className="screen landing" aria-labelledby="title">
      <p className="kicker">A game for outside</p>
      <div className="screen-body">
        <BrandMark className="landing-mark" />
        <h1 id="title" className="display">
          Can you <em>find</em> it?
        </h1>
        <p className="lede">
          Take a photo of where you are, or pick one of a place you pass every day. I&apos;ll secretly choose one thing in it. Find it
          with your own eyes, now or next time you&apos;re there, and show me a close-up.
        </p>
        {hunts.length > 0 && (
          <div className="hunts">
            <h2 className="figure-label">Your hunts</h2>
            <ul>
              {hunts.map((h) => (
                <li key={h.id}>
                  <button type="button" className="hunt-item" onClick={() => onOpen(h)}>
                    <span className="hunt-clue">{h.clue}</span>
                    <span className="stats">{status(h)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="promise fine muted">
          <p>The AI is Gemma, an open model running on your own computer.</p>
          <p>Your photos go from your phone to that computer and nowhere else.</p>
        </div>
      </div>
      <div className="screen-actions">
        <button type="button" className="btn btn-primary" onClick={onBegin}>
          {hunts.length ? "Another place" : "Choose a place"}
        </button>
      </div>
    </section>
  );
}
