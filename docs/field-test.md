# Field test protocol

The spike measured the engine on other people's photos. The field test measures
the *game*: does it make you look again at a place you pass every day, and do
you get the "ah, *that's* what it saw" moment?

## Before you start

- [ ] `npm run doctor` shows ✓ for Ollama, the model and memory. On a 16 GB
      laptop, quit the browser, editors and chat/design apps first: the model
      needs about 9.5 GB, and once the computer swaps every step gets several
      times slower.
- [ ] Laptop set to stay awake (`caffeinate -dims`), on the same Wi-Fi as the
      phone.
- [ ] `npm run field` running; the phone opens the URL from the QR code.
- [ ] One test round at home to warm the model up (the first round after a
      cold start is slower).

## Which places

Photos of places you pass often: your street, the way to the bakery, the view
from a window, a building's courtyard. Photos already in your library work.
Aim for variety; the spike suggests these behave differently:

| Kind of place | Expectation from the spike |
| --- | --- |
| Town square, old street, market | Good: lots of fixtures (plaques, signs, lamps). |
| Park, garden, campus | Mixed: good when there are made things, weak on lawns. |
| Playground | Tends to pick the obvious (slide, swings). |
| Street with traffic | Safe targets on the pavement; watch the safety rules. |
| Forest trail, beach, riverside | Weak: few discrete reachable objects; expect "nothing I trust". |

Five to eight places is enough for a write-up.

## Each round

1. **Choose a place**: take a wide photo where you are, or pick one of a place
   you pass often.
2. While it looks, note what *you* would have picked (that's the "did we see
   the same thing?" comparison).
3. Read the clue, take hints if you like ("My photo" shows the photo again).
4. Look for it without the phone, now or next time you pass by.
5. When you spot it, take a quick close-up and **Check it with a photo**, right
   away or later from your library. (**I saw it, no photo** shows the answer and
   asks you to say honestly whether that's what you saw.) If the verdict is
   wrong, say so:
   - it *was* it but it said NOT QUITE → **I'm sure it's this one**
   - it said FOUND IT but it wasn't → **It wasn't actually this**
6. On the reveal, mark **The AI got this wrong** if the target wasn't really
   there or the box missed it, and **That was a good one** for a great round.
   Use **Add a field note** for anything worth quoting.

## What gets recorded

Automatically, per round (`/notes` on the laptop, or the CSV):

- time the model took to look, and what it considered when it declined
- the target it chose and the clue line
- time from clue to the end, hints used, every check with its verdict, and
  whether you said you saw it

From your taps: overrides (possible false negatives), false positives, bad
targets, great moments, notes.

What only you can add afterwards, per round, for the article:

| Round | Place | Did the target exist? | What I'd have picked | Found? Time / hints | Good moment? |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## Afterwards

- Download `http://localhost:3000/api/notes?format=csv`.
- Photos stay in `.data/rounds/` on the laptop. Use "Forget this place" on any
  round you don't want to keep, or delete `.data/` when you're done.
- Note anything about latency, battery, network drops (the app resumes a round
  after a reload or a lost connection; say if it didn't).
