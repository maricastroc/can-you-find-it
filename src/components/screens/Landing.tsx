import { BrandMark } from "../Mark";

export function Landing({ onBegin }: { onBegin: () => void }) {
  return (
    <section className="screen landing" aria-labelledby="title">
      <p className="kicker">A game for outside</p>
      <div className="screen-body">
        <BrandMark className="landing-mark" />
        <h1 id="title" className="display">
          Can you <em>find</em> it?
        </h1>
        <p className="lede">
          I&apos;ll look at the place you&apos;re standing in, secretly choose one thing I see, and dare you to find it, with your own
          eyes, not the screen.
        </p>
        <div className="promise fine muted">
          <p>The AI is Gemma, an open model running on your own computer.</p>
          <p>Your photos go from your phone to that computer and nowhere else.</p>
        </div>
      </div>
      <div className="screen-actions">
        <button type="button" className="btn btn-primary" onClick={onBegin}>
          Take a look
        </button>
      </div>
    </section>
  );
}
