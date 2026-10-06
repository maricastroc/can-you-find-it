import type { Verdict as V } from "@/lib/hunt/check";

const COPY: Record<Exclude<V, "found">, { word: string; line: string }> = {
  almost: { word: "Almost.", line: "Right kind of thing. Not the one I saw." },
  not_quite: { word: "Not quite.", line: "That's not what I saw. Keep looking." },
};

type Props = {
  verdict: Exclude<V, "found">;
  hintsLeft: number;
  pending?: string;
  notice?: string;
  onKeepLooking: () => void;
  onHint: () => void;
  onInsist: () => void;
};

export function Verdict({ verdict, hintsLeft, pending, notice, onKeepLooking, onHint, onInsist }: Props) {
  const copy = COPY[verdict];
  return (
    <section className="screen verdict" aria-labelledby="verdict-word">
      <p className="kicker">{verdict === "almost" ? "Close" : "Keep going"}</p>
      <div className="screen-body">
        <div role="status">
          <h1 id="verdict-word" className="display">
            {copy.word}
          </h1>
        </div>
        <p className="lede">{copy.line}</p>
      </div>
      <div className="screen-actions">
        {notice && (
          <p className="notice" role="alert">
            {notice}
          </p>
        )}
        <button type="button" className="btn btn-primary" onClick={onKeepLooking}>
          Keep looking
        </button>
        {hintsLeft > 0 && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              onHint();
              onKeepLooking();
            }}
            disabled={pending === "hint"}
          >
            Get a hint
          </button>
        )}
        <button type="button" className="btn btn-quiet" onClick={onInsist} disabled={pending === "confirm"}>
          I&apos;m sure it&apos;s this one
        </button>
      </div>
    </section>
  );
}
