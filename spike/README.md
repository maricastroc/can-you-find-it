# Spike: can an open-weight VLM pick a real, findable secret target?

The product only works if a local, open-weight vision model can look at one
wide photo of a public place and:

1. choose a detail that is **really there**,
2. return a bounding box that **actually contains it**,
3. write a clue that makes a person **look at the place**,
4. later, tell whether the player's close-up shows **the same thing**.

This folder tests exactly that, before any UI exists. Nothing here trusts the
model's own judgement: every box is turned into a real crop, and every crop
was labelled by a human (see `data/labels.json`).

## Setup

- Model runtime: [Ollama](https://ollama.com) 0.35, Apple M4 / 16 GB.
- Models: `gemma4:e4b` (Gemma 4 E4B, Apache 2.0, Q4_K_M, 6.6 GB);
  `gemma4:12b` where noted.
- Gemma 4 natively emits boxes as `box_2d: [ymin, xmin, ymax, xmax]` on a
  0–1000 grid. Ollama ≥ 0.34.1 picks the vision token budget from the image
  resolution; at ≥ 1920 px the image costs ~1,100 tokens (the maximum budget),
  at 768 px only ~190, so we always send 1920 px to the model.
- Test set: 20 wide photos of public places from Wikimedia Commons
  (parks, squares, streets, a private lane, gardens, playgrounds, a riverside,
  a forest trail, a crowded square, street art, a village lane), 3 of them
  portrait. Attribution in `data/images/manifest.json`; the photos themselves
  are not committed (`npx tsx spike/src/fetch-selected.ts` downloads them).

## Strategies tried

| Run | What the model is asked |
| --- | --- |
| `dev-single` / `dev2-*` | Early prompt iterations (kept for the record). |
| `v3-single-e4b` | One call: 5 targets with box, lens, clue, hints. Then two independent checks on a **crop**: a yes/no question and a multiple-choice question. |
| `v4-*` | The product pipeline: 3 short proposals (label, box, look-alike count) → cheap filters → multiple-choice verification on the crop (+ "is a person visible?") → a separate writer call that sees the **zoomed crop** and writes the clue. |
| `write` | "Zoom then write": clues regenerated from the crop instead of the wide photo. |
| `compare` | FOUND IT check on 19 image pairs (real photos of the same object from another photographer/angle, augmented re-crops, and same-kind-different-object hard negatives). |

## Human labels

For each candidate (`data/labels.json`, key `run/image#idx`):

- `contains`: yes / partial / no — does the model's box hold the thing it
  described? `exists: false` marks a hallucination.
- `findable`: one specific, reachable thing a person could identify on site
  (fails for areas, look-alikes ×3+, things across water or far away).
- `interesting` 0–2, `clue` 0–2, `safe` (no people/vehicles/private access).

*Valid* = box yes + findable + safe. *Usable* = box yes **or partial** (the
padded reveal crop still shows it) + findable + safe. *Good* = usable +
interesting ≥ 1 + clue ≥ 1.

## Reproduce

```bash
npx tsx spike/src/fetch-selected.ts && npx tsx spike/src/normalize.ts && npx tsx spike/src/fetch-pairs.ts
npx tsx spike/src/run.ts --model gemma4:e4b --strategy single --run v3-single-e4b
npx tsx spike/src/run4.ts --model gemma4:e4b --run v4-e4b
npx tsx spike/src/simulate.ts v4-e4b v4b-e4b      # final policy on the same proposals
npx tsx spike/src/run4.ts --model gemma4:12b --run v4b-12b
npx tsx spike/src/run4.ts --model gemma4:e4b --run v5-e4b
npx tsx spike/src/run4.ts --model gemma4:e4b --run v6-e4b-1536 --side 1536 --skip-write
npx tsx spike/src/compare.ts gemma4:e4b --v2
PICKS_RUN=v4b-e4b npx tsx spike/src/report.ts v3-single-e4b v4-e4b v4b-e4b v4b-12b   # → spike/data/report.html
npx vitest run spike                               # unit tests for the engine helpers
```

## Results (2026-10-05)

All numbers are human labels on real crops. Visual report:
`python3 -m http.server 8765 --directory spike/data` → <http://localhost:8765/report.html>.

### Target selection, same 20 photos

| | v3 single pass (5 targets) | v4 (3 short proposals + verify) | **v4b (final policy)** | v4b, Gemma 4 12B (8 photos) |
| --- | --- | --- | --- | --- |
| Box contains the described thing | 72% | 88% | **88%** | 41% |
| Box partially contains it | 19% | 12% | 12% | 17% |
| Box misses it / invented | 9% | 0% | **0%** | 41% |
| Candidates valid (box ✓, findable, safe) | 44% | 62% | 62% | 29% |
| Photos where the engine commits to a target | 90% | 80% | 80% | 88% |
| …that target is usable (real, findable, safe) | 61% | 75% | **81%** | 71% |
| …that target is good (usable + interesting + true clue) | 39% | 44% | **63%** | 57% |
| Verifier precision / recall vs. humans | 51% / 84% | 71% / 59% | **76% / 84%** | 70% / 100% |
| Median wait for a verified target + clue | ~76 s | 47 s | **44 s** | 94 s |

v4b re-ran verification, ranking and clue selection on v4's proposals with the
fixed policy (`src/simulate.ts`), so the two columns compare policies on the
same candidates.

Per photo, with v4b on Gemma 4 E4B: **~1 in 2 photos produces a good round**
(real, findable, interesting, with a true clue), ~1 in 5 gets an honest
"nothing I trust here", and the rest are playable but mundane or flawed.

### FOUND IT check (19 pairs, Gemma 4 E4B)

| | v1 prompt (same / not same) | v2 prompt (details → same kind / same object) | **v3 (shipped)** |
| --- | --- | --- | --- |
| Same object, another photographer & angle | 5/5 | 4/5 | **5/5** |
| Same object, re-cropped + rotated | 5/5 | 5/5 | **5/5** |
| Same kind, different object (bench vs bench…) | 4/7 | 7/7 | 6/7 |
| Unrelated | 2/2 | 2/2 | 2/2 |
| Latency | ~6 s | ~10 s | ~7 s |

v2/v3 separate `same_kind` from `same_object`, which gives the game an honest
middle state: *ALMOST — right kind of thing, not the one I saw.* v3 (in
`src/lib/hunt/prompts.ts` + `check.ts`) asks for details of the object itself,
not its background, and only says ALMOST when the description of the player's
photo names the target's kind of object — added after a live test where a
plant label among leaves was called "almost" a tree trunk among leaves. Its one
miss: two similar concrete road bridges judged to be the same bridge.

### Clues

| | mean score (0–2), 33 usable targets |
| --- | --- |
| Clue written in the single-pass proposal | 1.03 |
| "Zoom then write" (model writes from the crop) | 0.64 — worse, and its "reveal" invents details |
| **Human-written lens line, chosen by rules + model** | **~1.55** (23/33 scored 2) |

### Time to the first clue (2026-10-06)

The first playtest said the wait after the wide photo was too long. v5 keeps
the v4b policy and cuts what happens before the clue appears:

| | v4 | **v5 (shipped)** |
| --- | --- | --- |
| Proposals | 3, labels of 4–12 words, plus a difficulty | 2, labels of 3–8 words |
| Verification crop | 1024 px | 768 px |
| Clue line | chosen in a writer call (~10 s) before anything is shown | chosen by rules from the label, or from where the target sits in the frame |
| Hints | written before the clue appears | written in the background while the player starts looking |
| Median wait for a verified target + clue (20 photos) | 47 s | **26 s** |
| Photos with a verified target | 16/20 | 17/20 |

Output length is capped on every call, and opening the camera now runs one
tiny pass through the model, so a model that was unloaded or paged out comes
back while the player is still framing the photo (~9 s from cold, instant when
it's already warm).

Memory matters more than any of this. The model needs about 9.5 GB while it
runs. On the 16 GB test machine, the same proposal call took 11–22 s with the
model's memory to itself, 27–45 s while other apps pushed the computer into
swap, and once 16 minutes. `npm run doctor` now warns when the computer is
swapping.

**Tried and rejected: a smaller wide photo.** At 1536 px the image costs ~25%
fewer tokens, but on the first 11 photos it lost the best small targets (the
memorial plaque, the information sign, which became "the mossy base of the
tree") and verified a target on 9 photos instead of 11 (`runs/v6-e4b-1536`;
its timings are not comparable, the machine was swapping). The product keeps
1920 px.

### What failed, and what fixed it

1. **Inventing "interesting" details** (moss, drains, bollards that aren't
   there) when asked for 5 interesting targets. → Ask for 3, short, "only
   what you can see with certainty"; verify every crop.
2. **Area targets** (foliage, facades, the path). → Head-noun filter + box
   size limit.
3. **Yes-bias in verification** (a yes/no verifier repeats the label back). →
   Multiple choice against the other candidates from the same photo.
4. **Letter mapping** (the model described the crest correctly and then
   answered the wrong letter). → The answer is the option text itself.
5. **Over-strict people check** (anyone in the background killed good
   targets). → "Is a person *at* the target?" — keeps the crest, still drops
   the occupied bench and swing.
6. **Weak, flowery or wrong clues.** → Human-written lens lines; rules map
   common objects (lamp → *It only does its job after dark*), the model only
   picks perceptual lenses, otherwise a spatial default.
7. **Look-alikes** (identical lamps along a promenade): the model's
   `similar_count` is unreliable. Still open; the ALMOST state softens it.
8. **Scenes without reachable discrete objects** (forest trail, view across a
   river, close-up of a pond). The engine mostly declines — correct, but
   it's ~20% of photos.
9. **Gemma 4 12B localises much worse** than E4B on this task (and is 2×
   slower), so the product uses E4B.

Not tested: tiling the wide photo. The failures we saw were about choosing
and verifying, not resolution — v4 already finds small plaques and plant
labels at 1920 px.
