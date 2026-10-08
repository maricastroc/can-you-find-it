"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ClueText } from "../ClueText";
import { useBackToClose } from "@/lib/client/back";
import type { PublicRound } from "@/lib/rounds/types";

type Props = {
  round: PublicRound;
  photo?: string;
  pending?: string;
  notice?: string;
  onSaw: () => void;
  onFound: () => void;
  onHint: () => void;
  onGiveUp: () => void;
  onHome: () => void;
};

export function Hunt({ round, photo, pending, notice, onSaw, onFound, onHint, onGiveUp, onHome }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [confirmingSaw, setConfirmingSaw] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const photoTitle = useId();
  const photoButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const focusRow = useRef<HTMLLIElement>(null);
  const waitingForHint = pending === "hint";
  const hidePhoto = useCallback(() => setShowPhoto(false), []);
  const closePhoto = useBackToClose(showPhoto, hidePhoto, "cyfiPhoto");

  useEffect(() => {
    if (!showPhoto) return;
    const opener = photoButton.current;
    backButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePhoto();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [showPhoto, closePhoto]);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  useEffect(() => {
    if (!confirmingSaw) return;
    const t = setTimeout(() => setConfirmingSaw(false), 4000);
    return () => clearTimeout(t);
  }, [confirmingSaw]);

  const hintCount = round.hints.length;
  useEffect(() => {
    if (hintCount || waitingForHint)
      focusRow.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "center",
      });
  }, [hintCount, waitingForHint]);

  const latest = round.hints.at(-1)?.level;

  return (
    <section className="screen hunt" aria-labelledby="clue">
      <p className="kicker">I found something.</p>
      <div className="screen-body">
        <div id="clue">
          <ClueText text={round.clue ?? ""} as="h1" />
        </div>
        <p className="lede muted">Find it with your own eyes, now or next time you&apos;re there. Then show me a close-up.</p>
        {(round.hints.length > 0 || waitingForHint) && (
          <ol className="hints" aria-label="Hints" aria-live="polite">
            {round.hints.map((h) => (
              <li
                key={h.level}
                ref={!waitingForHint && h.level === latest ? focusRow : undefined}
                data-new={h.level === latest || undefined}
              >
                <span className="hint-n" aria-hidden="true">
                  {String(h.level).padStart(2, "0")}
                </span>
                {h.kind === "text" ? (
                  <span>{h.text}</span>
                ) : (
                  <>
                    <span>{h.text}</span>
                    <img
                      className={h.kind === "glimpse" ? "hint-image" : "hint-area"}
                      src={h.imageUrl}
                      alt={
                        h.kind === "glimpse"
                          ? "A heavily pixelated glimpse of the hidden thing"
                          : "Your photo, dark except for the part where it is"
                      }
                    />
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
          Check it with a photo
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
          {photo && (
            <button ref={photoButton} type="button" className="btn btn-secondary" onClick={() => setShowPhoto(true)}>
              My photo
            </button>
          )}
        </div>
        {confirmingSaw ? (
          <button type="button" className="btn btn-text" onClick={onSaw} disabled={pending === "seen"}>
            Show me what it was
          </button>
        ) : (
          <button type="button" className="btn btn-text" onClick={() => setConfirmingSaw(true)}>
            I saw it, no photo
          </button>
        )}
        <div className="row row-quiet">
          <button type="button" className="btn btn-quiet" onClick={onHome}>
            Your hunts
          </button>
          {confirming ? (
            <button type="button" className="btn btn-text confirm-giveup" onClick={onGiveUp} disabled={pending === "reveal"}>
              Show me the answer
            </button>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)}>
              Give up
            </button>
          )}
        </div>
      </div>
      {photo && showPhoto && (
        <div className="photo-view" role="dialog" aria-modal="true" aria-labelledby={photoTitle}>
          <p className="kicker" id={photoTitle}>
            Your photo
          </p>
          <img src={photo} alt="Your photo of this place" />
          <p className="photo-view-note">It&apos;s somewhere in here.</p>
          <button ref={backButton} type="button" className="btn btn-primary" onClick={closePhoto}>
            Back to the hunt
          </button>
        </div>
      )}
    </section>
  );
}
