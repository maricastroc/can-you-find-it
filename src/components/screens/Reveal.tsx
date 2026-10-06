/* eslint-disable @next/next/no-img-element -- private no-store API images and on-device blob: URLs */
"use client";

import { useState } from "react";
import { Mark } from "../Mark";
import type { Feedback, PublicRound } from "@/lib/rounds/types";

type Props = {
  round: PublicRound;
  foundPreview?: string;
  onAgain: () => void;
  onFeedback: (kind: Feedback["kind"], note?: string) => Promise<void>;
  onForget: () => Promise<void>;
};

function FieldNote({ onSave }: { onSave: (note: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  if (saved) return <p className="fine muted" role="status">Noted in the field log.</p>;
  if (!open)
    return (
      <button type="button" className="btn btn-text" onClick={() => setOpen(true)}>
        Add a field note
      </button>
    );
  return (
    <form
      className="field-note"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        await onSave(text.trim());
        setSaved(true);
      }}
    >
      <label className="figure-label" htmlFor="field-note">
        Field note
      </label>
      <textarea id="field-note" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened? What did you notice?" />
      <button type="submit" className="btn btn-secondary" disabled={!text.trim()}>
        Save note
      </button>
    </form>
  );
}

function statsLine(stats: PublicRound["stats"]) {
  if (!stats) return undefined;
  const parts: string[] = [];
  if (stats.seconds !== undefined) {
    const m = Math.floor(stats.seconds / 60);
    parts.push(m >= 1 ? `${m} min ${stats.seconds % 60} s` : `${stats.seconds} s`);
  }
  parts.push(stats.hints === 1 ? "1 hint" : `${stats.hints} hints`);
  if (stats.attempts > 1) parts.push(`${stats.attempts} photos`);
  return parts.join(" · ");
}

export function Reveal({ round, foundPreview, onAgain, onFeedback, onForget }: Props) {
  const found = round.status === "found";
  const reveal = round.reveal;
  const [sent, setSent] = useState<Set<Feedback["kind"]>>(new Set());
  const [where, setWhere] = useState(false);
  const [forgetting, setForgetting] = useState<"idle" | "confirm" | "working">("idle");

  const send = async (kind: Feedback["kind"]) => {
    if (sent.has(kind)) return;
    setSent((s) => new Set(s).add(kind));
    await onFeedback(kind).catch(() => setSent((s) => (s.delete(kind), new Set(s))));
  };

  // Frames take the reveal image's exact proportions so the mark stays on target.
  const ar = { "--ar": reveal?.imageAspect ?? 1 } as React.CSSProperties;
  const seen = reveal && (
    <figure className="figure">
      <figcaption className="figure-label">What I saw</figcaption>
      <div className="frame frame-fit" style={ar}>
        <img src={reveal.imageUrl} alt={`The part of your photo I chose: ${reveal.label}`} />
        <Mark box={reveal.box} />
      </div>
    </figure>
  );

  return (
    <section className="screen reveal" aria-labelledby="reveal-title">
      <p className="kicker">{found ? "Found it" : "It was this"}</p>
      <div className="screen-body">
        <div role="status">
          <h1 id="reveal-title" className="sr-only">
            {found ? "Found it." : "It was this."}
          </h1>
        </div>
        {reveal && found && foundPreview ? (
          <div className="diptych">
            {seen}
            <figure className="figure">
              <figcaption className="figure-label">What you saw</figcaption>
              <div className="frame frame-fit frame-cover" style={ar}>
                <img src={foundPreview} alt="The photo you took when you found it" />
              </div>
            </figure>
          </div>
        ) : (
          seen
        )}

        {reveal && (
          <div className="caption">
            <p className="title">{reveal.label}.</p>
            {reveal.detail && <p className="muted">{reveal.detail}</p>}
            {statsLine(round.stats) && <p className="stats">{statsLine(round.stats)}</p>}
          </div>
        )}

        {reveal && (
          <div>
            <button type="button" className="btn btn-text" aria-expanded={where} onClick={() => setWhere((w) => !w)}>
              {where ? "Hide where it was" : "Where was it in my photo?"}
            </button>
            {where && (
              <div className="frame where" style={{ aspectRatio: reveal.photoAspect }}>
                <img src={reveal.photoUrl} alt="Your wide photo" />
                <Mark box={reveal.photoBox} label={`It was here: ${reveal.label}`} />
              </div>
            )}
          </div>
        )}

        <div className="chips" role="group" aria-label="How was this one?">
          <button type="button" className="chip" aria-pressed={sent.has("great_moment")} onClick={() => send("great_moment")}>
            That was a good one
          </button>
          <button type="button" className="chip" aria-pressed={sent.has("target_wrong")} onClick={() => send("target_wrong")}>
            The AI got this wrong
          </button>
          {found && !round.stats?.overridden && (
            <button
              type="button"
              className="chip"
              aria-pressed={sent.has("should_not_have_matched")}
              onClick={() => send("should_not_have_matched")}
            >
              It wasn&apos;t actually this
            </button>
          )}
        </div>

        <FieldNote onSave={(note) => onFeedback("note", note)} />

        <div className="keep-going">
          <p className="kicker">Keep going</p>
          <p className="lede">Walk for a few minutes. Then look around again.</p>
        </div>
      </div>
      <div className="screen-actions">
        <button type="button" className="btn btn-primary" onClick={onAgain}>
          Look around again
        </button>
        {forgetting === "confirm" ? (
          <button
            type="button"
            className="btn btn-text confirm-giveup"
            onClick={async () => {
              setForgetting("working");
              await onForget().catch(() => setForgetting("idle"));
            }}
          >
            Delete this round&apos;s photos
          </button>
        ) : (
          <button type="button" className="btn btn-quiet" onClick={() => setForgetting("confirm")} disabled={forgetting === "working"}>
            Forget this place
          </button>
        )}
      </div>
    </section>
  );
}
