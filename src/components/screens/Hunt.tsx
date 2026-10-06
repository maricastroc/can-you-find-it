"use client";

import { useEffect, useRef, useState } from "react";
import { ClueText } from "../ClueText";
import type { PublicRound } from "@/lib/rounds/types";

export const REST_AFTER_MS = 30_000;

type Props = {
  round: PublicRound;
  pending?: string;
  notice?: string;
  onFound: () => void;
  onHint: () => void;
  onGiveUp: () => void;
  onRest: () => void;
};

export function Hunt({ round, pending, notice, onFound, onHint, onGiveUp, onRest }: Props) {
  const [confirming, setConfirming] = useState(false);
  const focusRow = useRef<HTMLLIElement>(null);
  const waitingForHint = pending === "hint";

  useEffect(() => {
    if (waitingForHint) return;
    let timer = setTimeout(onRest, REST_AFTER_MS);
    const poke = () => {
      clearTimeout(timer);
      timer = setTimeout(onRest, REST_AFTER_MS);
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, poke, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, poke));
    };
  }, [onRest, waitingForHint]);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const hintCount = round.hints.length;
  useEffect(() => {
    if (hintCount || waitingForHint) focusRow.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [hintCount, waitingForHint]);

  const latest = round.hints.at(-1)?.level;

  return (
    <section className="screen hunt" aria-labelledby="clue">
      <p className="kicker">I found something.</p>
      <div className="screen-body">
        <div id="clue">
          <ClueText text={round.clue ?? ""} as="h1" />
        </div>
        <p className="lede muted">Can you find it?</p>
        {(round.hints.length > 0 || waitingForHint) && (
          <ol className="hints" aria-label="Hints" aria-live="polite">
            {round.hints.map((h) => (
              <li key={h.level} ref={!waitingForHint && h.level === latest ? focusRow : undefined} data-new={h.level === latest || undefined}>
                <span className="hint-n" aria-hidden="true">
                  {String(h.level).padStart(2, "0")}
                </span>
                {h.kind === "text" ? (
                  <span>{h.text}</span>
                ) : (
                  <>
                    <span>A blurred glimpse of what I saw.</span>
                    <img className="hint-image" src={h.imageUrl} alt="A heavily pixelated glimpse of the hidden thing" />
                  </>
                )}
              </li>
            ))}
            {waitingForHint && (
              <li ref={focusRow} className="hint-pending">
                <span className="hint-n" aria-hidden="true">
                  {String(round.hints.length + 1).padStart(2, "0")}
                </span>
                <span>Getting a hint…</span>
              </li>
            )}
          </ol>
        )}
      </div>
      <div className="screen-actions">
        {notice && (
          <p className="notice" role="alert">
            {notice}
          </p>
        )}
        <button type="button" className="btn btn-primary" onClick={onFound}>
          I found it
        </button>
        <div className="row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onHint}
            disabled={round.hintsLeft === 0 || waitingForHint}
            aria-label={round.hintsLeft === 0 ? "No hints left" : `Hint, ${round.hintsLeft} left`}
          >
            {round.hintsLeft === 0 ? "No hints left" : "Hint"}
            {round.hintsLeft > 0 && (
              <span className="count" aria-hidden="true">
                {round.hintsLeft}
              </span>
            )}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onRest}>
            Look up
          </button>
        </div>
        {confirming ? (
          <button type="button" className="btn btn-text confirm-giveup" onClick={onGiveUp} disabled={pending === "reveal"}>
            Show me what it was
          </button>
        ) : (
          <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)}>
            Give up
          </button>
        )}
      </div>
    </section>
  );
}

export function Rest({ clue, onWake }: { clue: string; onWake: () => void }) {
  return (
    <button type="button" className="rest" onClick={onWake} aria-label={`Resting. ${clue} Tap to wake the screen.`}>
      <div>
        <p className="title">{clue}</p>
        <div className="rest-pulse" />
      </div>
      <span className="rest-wake" aria-hidden="true">
        Tap when you&apos;ve found it
      </span>
    </button>
  );
}
