import { stageLine, type Stage } from "@/lib/client/game";

const ORDER: Stage[] = ["uploading", "looking", "checking"];

export function Looking({ photo, stage, attempt }: { photo?: string; stage: Stage; attempt?: number }) {
  const now = ORDER.indexOf(stage);
  return (
    <section className="looking" aria-busy="true" aria-labelledby="looking-title">
      {photo && <img className="looking-photo" src={photo} alt="" />}
      <div className="looking-attention" aria-hidden="true" />
      <div className="looking-copy">
        <p className="kicker">Looking</p>
        <h1 id="looking-title" className="title">
          While I look, look around too. What would you pick?
        </h1>
        <ol className="stages" aria-hidden="true">
          {ORDER.map((s, i) => (
            <li key={s} data-state={i < now ? "done" : i === now ? "now" : "later"} />
          ))}
        </ol>
        <p className="fine muted" role="status" aria-live="polite">
          {stageLine(stage, attempt)}
        </p>
      </div>
    </section>
  );
}

export function Checking({ photo }: { photo?: string }) {
  return (
    <section className="checking" aria-busy="true" aria-labelledby="checking-title">
      {photo && <img className="looking-photo" src={photo} alt="" />}
      <div className="checking-copy">
        <p className="kicker">Checking</p>
        <h1 id="checking-title" className="title">
          Comparing it with what I saw…
        </h1>
        <p className="sr-only" role="status">
          Checking your photo.
        </p>
      </div>
    </section>
  );
}
