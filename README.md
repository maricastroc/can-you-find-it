# Can You Find It?

*I Spy, but the AI chooses what to look for from the place you're actually standing in.*

You take one wide photo of where you are. A local, open model (Gemma 4) looks at
it, secretly chooses one real thing it can see, and gives you a single line:

> **I FOUND SOMETHING.**
> *Someone wanted this place to remember something.*
> Can you find it?

Then you put the phone away and look — at the place, not the screen. When you
think you've found it, you take a close photo; the model compares it with what
it saw. At the end you see both side by side: *what I saw / what you saw.*

The model can see the park. It can't walk through it. That part is yours.

## How a round works

```
wide photo ──► Gemma 4 E4B proposes 2 targets, each with a box (box_2d, 0–1000 grid)
           ──► cheap filters (areas, people, animals, vehicles, look-alikes, huge boxes)
           ──► verification on a real crop: multiple choice against the other
               candidates + "is a person at it?"  (first one that passes wins)
           ──► a human-written clue line, chosen by rules from what the target
               is (or where it sits in the frame) — shown right away
           ──► while you start looking, the model writes two hints; a third
               hint comes from the box itself
           ──► you hunt  (hints: meaning → appearance → direction → pixelated glimpse)
           ──► your close-up vs the crop: same object → FOUND IT,
               same kind → ALMOST, otherwise NOT QUITE
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

## Playing outside

1. Put the phone and the computer on the same network. The simplest: turn on
   the phone's hotspot and join it from the computer.
2. Keep the computer awake (lid open, or `caffeinate -dims` in a terminal).
3. Start the game in production mode:

   ```bash
   npm run field
   ```

4. On the phone, open the URL from `npm run doctor`. Add it to the home screen
   if you like.

By default the phone's own camera app takes the photos — that works over plain
HTTP with no setup. For the in-app live viewfinder the page needs HTTPS:

```bash
brew install mkcert && mkcert -install
```

```bash
npm run certs
```

Then trust mkcert's root certificate on the phone (the `certs` script prints the
three steps), run `npm run field:https` next to `npm run field`, and open
`https://<computer-ip>:3443`.

Expect about **20–30 s** from the wide photo to the clue on an M4 laptop with
enough free memory (the hints are written while you start looking), and
**~7 s** to check a close-up. The model starts waking up as soon as you open the
camera. If it takes much longer, the computer is probably swapping: quit other
apps and run `npm run doctor`.

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
- The computer has to be within reach of the phone's network.
- English only.

## Credits

Test photos for the spike: Wikimedia Commons contributors, under CC licences
(attribution in `spike/data/images/manifest.json`). Model: Gemma 4 by Google
DeepMind (Apache 2.0), run with Ollama.
