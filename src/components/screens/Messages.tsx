/** Screens that only carry a message: nothing to hunt, and errors. */

export function Nothing({ onAgain }: { onAgain: () => void }) {
  return (
    <section className="screen" aria-labelledby="nothing-title">
      <p className="kicker">Nothing to hunt</p>
      <div className="screen-body">
        <div role="status">
          <h1 id="nothing-title" className="headline">
            I couldn&apos;t find anything I&apos;d trust here.
          </h1>
        </div>
        <p className="lede muted">
          I&apos;d rather say so than make something up. Point me at a spot with details: signs, plaques, lamps, carvings, things people
          made or left behind.
        </p>
      </div>
      <div className="screen-actions">
        <button type="button" className="btn btn-primary" onClick={onAgain}>
          Look around again
        </button>
      </div>
    </section>
  );
}

const HELP: Record<string, string | undefined> = {
  model_unavailable: "On the computer running the game, start the model with: ollama serve",
  offline: "Check that your phone is on the same Wi-Fi or hotspot as the computer running the game.",
  timeout: "The computer may be busy. Give it a moment and try again.",
  bad_photo: undefined,
};

export function ErrorScreen({ code, message, retry, onRetry }: { code: string; message: string; retry: string; onRetry: () => void }) {
  const help = HELP[code];
  return (
    <section className="screen" aria-labelledby="error-title">
      <p className="kicker">Something got in the way</p>
      <div className="screen-body" role="alert">
        <h1 id="error-title" className="title">
          {message}
        </h1>
        {help && <p className="error-help">{help}</p>}
      </div>
      <div className="screen-actions">
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          {retry === "check" ? "Take the photo again" : retry === "home" ? "Start over" : "Try again"}
        </button>
      </div>
    </section>
  );
}
