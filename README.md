# Can You Find It?

*I Spy, but the AI hides something real in a place you know — and checks that you found it.*

Take a photo of where you are, or pick one of a place you pass every day: your
street, the way to the bakery, the view from a window. A local, open model
(Gemma 4) looks at it, secretly chooses one real thing in it, and gives you a
single line:

> **I FOUND SOMETHING.**
> *Someone wanted this place to remember something.*
> Find it with your own eyes, now or next time you're there.

You look at the place, not the screen. When you spot it, you snap a close-up —
right away, or a five-second photo on your way past, sent whenever you like.
The model compares it with what it saw: FOUND IT, ALMOST or NOT QUITE. At the
end you see both side by side: *what I saw / what you saw.* (If you don't want
to take the phone out at all, *I saw it, no photo* shows the answer and lets you
say whether that's what you saw.)

The model can see the street. It can't walk down it. That part is yours.

You can keep several hunts open at once, one per place.

## How a round works

```
a photo of a place ──► Gemma 4 E4B proposes 2 targets, each with a box (box_2d, 0–1000 grid)
           ──► cheap filters (areas, people, animals, vehicles, look-alikes, huge boxes)
           ──► verification on a real crop: multiple choice against the other
               candidates + "is a person at it?"  (first one that passes wins)
           ──► a human-written clue line, chosen by rules from what the target
               is (or where it sits in the frame) — shown right away
           ──► while you start looking, the model writes two hints; a third
               hint comes from the box itself
           ──► you look, now or next time you're there  (hints: meaning → appearance
               → direction → pixelated glimpse → the part of your photo where it is)
           ──► your close-up (taken now, or picked from your photos later): the
               model first says what it shows without
               knowing the target, a text-only question checks whether that
               could be the target, and only then is it compared with the crop:
               same object → FOUND IT, same kind → ALMOST, otherwise NOT QUITE
           ──► reveal: the crop with the model's box, your photo, where it was
```

Every design choice above came out of a measured spike on 20 real photos with
184 hand-labelled candidates — see [`spike/README.md`](spike/README.md). In
short: Gemma 4 E4B localises real objects well (88% of boxes correct, 0%
invented with the final prompt), the larger 12B localises much worse on this
task, free-written clues were weak (so the clue lines are written by people and
the model only chooses), and verification by multiple choice beats yes/no.

## What runs where (the privacy claim, precisely)

| | Where | Notes |
| --- | --- | --- |
| The game UI | your phone's browser | |
| Photo resizing | your phone | Re-encoded through a canvas before upload, which drops EXIF/GPS. (If the browser can't decode a photo, the original goes to the computer and is stripped there.) |
| The model (Gemma 4 E4B, Apache 2.0) | your computer, via [Ollama](https://ollama.com) | Never a cloud API. |
| Photos, crops, rounds | your computer, `.data/` | Re-encoded again on arrival (no metadata). "Forget this place" deletes a round's photos; `rm -rf .data` deletes everything. |
| Field log | your computer, `.data/fieldlog.jsonl` | Text only (labels, verdicts, timings, your notes). Viewable at `/notes`, only from the computer itself. |
| Fonts | bundled at build time | `next/font` self-hosts them; no font requests at runtime. |

Photos travel from the phone to the computer **over your own network** (Wi-Fi
or the phone's hotspot) and nowhere else. The app makes no third-party requests
at runtime, and `npm run field` builds with Next.js telemetry turned off.
Installing it does need the internet (npm packages, the model, the fonts at
build time). If you choose to reach the computer through a tunnel or
VPN, your traffic goes through that network — Tailscale keeps it end-to-end
encrypted; a public tunnel (e.g. Cloudflare) would decrypt it on their side, so
don't use one if the privacy claim matters to you.

## Setup

Requirements: a Mac or Linux machine, Node.js 20+, Ollama ≥ 0.34.1. The model
takes about 9.5 GB of memory while it runs (tested on an Apple M4 with 16 GB).
On a 16 GB machine, quit browsers, editors and other heavy apps before playing:
once the computer starts swapping, every step gets several times slower.

```bash
ollama pull gemma4:e4b
```

```bash
npm install
```

```bash
npm run doctor
```

`doctor` checks that Ollama and the model are ready, warns when the computer is
short of memory or swapping, and prints the address (and a QR code) to open on
the phone.

## Playing

The screen part happens at home, so the phone and the computer only need the
same Wi-Fi:

1. Put the phone and the computer on the same network.
2. Keep the computer awake while you play (lid open, or `caffeinate -dims` in a
   terminal).
3. Start the game in production mode:

   ```bash
   npm run field
   ```

4. On the phone, open the URL from `npm run doctor`. Add it to the home screen
   if you like.

Both photos (the place and the close-up) can be taken on the spot with the
phone's camera app or picked from the photo library; that works over plain HTTP
with no setup. For an in-app live viewfinder for the close-up the page needs
HTTPS:

```bash
brew install mkcert && mkcert -install
```

```bash
npm run certs
```

Then trust mkcert's root certificate on the phone (the `certs` script prints the
three steps), run `npm run field:https` next to `npm run field`, and open
`https://<computer-ip>:3443`.

Expect about **20–30 s** from the photo to the clue on an M4 laptop with enough
free memory (the hints are written in the background), and **~3 s** for the
model to say a close-up is something else, **~10 s** to confirm a real one. The
model starts waking up as soon as you choose a place. If it takes much longer,
the computer is probably swapping: quit other apps and run `npm run doctor`.

## Field notes

Everything the write-up needs is recorded automatically: how long the model
looked, time from clue to find, hints used, every check and its verdict. What
only you can tell, you mark at the end of a round:

| You saw… | Do this | Logged as |
| --- | --- | --- |
| The model said NOT QUITE but it *was* it | "I'm sure it's this one" | override (false negative) |
| The model said FOUND IT but it wasn't | "It wasn't actually this" | false positive |
| The target was wrong / not really there | "The AI got this wrong" | bad target |
| A round worth writing about | "That was a good one" | great moment |
| Anything else | "Add a field note" | note |

Open <http://localhost:3000/notes> **on the computer** for a summary and every
round, or download the CSV. See [`docs/field-test.md`](docs/field-test.md) for a
protocol.

## Development

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run typecheck
```

- `npm test` runs unit, component and accessibility (axe) tests, plus the engine
  replayed against **recorded real Gemma replies** (`src/lib/hunt/__fixtures__`)
  — deterministic, no model needed. `npm run fixtures` re-records them (needs
  Ollama).
- `?camera=native` skips the live viewfinder (useful on desktop).
- Environment: `HUNT_MODEL` (default `gemma4:e4b`), `HUNT_OLLAMA_URL` (default
  `http://127.0.0.1:11434`), `HUNT_DATA_DIR` (default `.data`).

### Code map

| Path | What |
| --- | --- |
| `src/lib/hunt/` | The engine: prompts, box geometry, filters, verification, clue lenses, the FOUND IT check, image crops. Model-agnostic and pure where possible. |
| `src/lib/rounds/` | Round lifecycle, disk store, field notes. Keeps the target secret until the round ends. |
| `src/app/api/` | Route handlers. `POST /api/rounds` streams progress as NDJSON. |
| `src/lib/client/` | Browser side: API client, the round as a pure state machine, photo prep. |
| `src/components/` | Camera and the screens. |
| `spike/` | The validation spike: scripts, labels, metrics, report. |

## Known limits

- In the spike, about 1 in 2 photos produced a genuinely good round, 1 in 5 got
  an honest "nothing I trust here" (forest trails, views across water), the rest
  were playable but mundane. Point it at places with *things*: signs, plaques,
  lamps, carvings, things people made or left behind.
- Look-alike objects (a row of identical lamps) are the main open problem; the
  ALMOST verdict softens it.
- The computer has to be on the same network as the phone when you choose a
  place or check a hunt (not while you walk).
- "I saw it, no photo" is on your honour: the game shows what it chose and
  trusts your answer. The close-up check is the normal way to finish.
- English only.

## Credits

Test photos for the spike: Wikimedia Commons contributors, under CC licences
(attribution in `spike/data/images/manifest.json`). Model: Gemma 4 by Google
DeepMind (Apache 2.0), run with Ollama.
