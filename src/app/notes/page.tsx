/* eslint-disable @next/next/no-img-element -- private no-store API images */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { isLocalHost, loadRows, summarize, type NoteRow } from "@/lib/rounds/notes";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Field notes · Can You Find It?" };

const OUTCOME: Record<NoteRow["status"], string> = {
  found: "Found",
  revealed: "Gave up",
  none: "Nothing to hunt",
  hunting: "In play",
  looking: "Looking",
  error: "Error",
};

const mmss = (s?: number) => (s === undefined ? "–" : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

export default async function Notes() {
  if (!isLocalHost((await headers()).get("host"))) {
    return (
      <main className="notes">
        <p className="lede">Field notes are only shown on the computer running the game.</p>
      </main>
    );
  }
  const rows = await loadRows();
  const s = summarize(rows);
  return (
    <main className="notes">
      <header className="notes-head">
        <p className="kicker">Can you find it? · Field notes</p>
        <h1 className="headline">What happened out there.</h1>
        <p className="lede">
          {s.rounds} {s.rounds === 1 ? "round" : "rounds"}. {s.found} found, {s.gaveUp} given up, {s.noTarget} with nothing to hunt
          {s.errors ? `, ${s.errors} errors` : ""}. Median {mmss(s.medianLookingSeconds)} for the model to look, {mmss(s.medianSecondsToFind)} to
          find, {s.medianHints ?? "–"} hints.
        </p>
        <p className="fine muted">
          Flags: {s.greatMoments} great moments · {s.badTargets} bad targets · {s.falsePositives} false “found” · {s.overrides} overrides
          (possible false “not quite”).{" "}
          <a href="/api/notes?format=csv">Download CSV</a> · <a href="/api/notes">JSON</a>
        </p>
      </header>
      <ol className="notes-list">
        {rows.map((r) => (
          <li key={r.id} className="note">
            {(r.status === "found" || r.status === "revealed") && (
              <img className="note-thumb" src={`/api/rounds/${r.id}/image/reveal`} alt={r.label ?? "Target"} loading="lazy" />
            )}
            <div className="note-body">
              <p className="kicker muted">
                {new Date(r.at).toLocaleString()} · {OUTCOME[r.status]}
              </p>
              {r.clue && <p className="title">{r.clue}</p>}
              {r.label && <p>{r.label}</p>}
              <p className="fine muted">
                looked {mmss(r.lookingSeconds)} · {r.status === "found" ? `found in ${mmss(r.secondsToEnd)}` : r.secondsToEnd !== undefined ? `ended after ${mmss(r.secondsToEnd)}` : "—"} · {r.hints}{" "}
                {r.hints === 1 ? "hint" : "hints"}
                {r.verdicts.length > 0 && ` · ${r.verdicts.join(" → ")}`}
              </p>
              <p className="fine">
                {r.greatMoment && <span className="flag">great moment</span>}
                {r.flaggedBadTarget && <span className="flag">bad target</span>}
                {r.flaggedFalsePositive && <span className="flag">false found</span>}
                {r.override && <span className="flag">override</span>}
              </p>
              {r.notes.map((n, i) => (
                <p key={i} className="note-text">
                  “{n}”
                </p>
              ))}
              {r.status === "none" && r.proposals.length > 0 && <p className="fine muted">Considered: {r.proposals.join("; ")}</p>}
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
