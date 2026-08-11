---
name: drill
description: Run a coding drill — presents a problem cold, rations hints, logs the attempt
---

# /drill [pattern|problem]

Run one coding drill. `rules/no-spoilers.md` governs everything below and
overrides any instinct to be helpful.

## Selecting

- **A problem name** (`/drill celebrity`) — use it.
- **A pattern name** (`/drill intervals`) — pick a problem under that pattern,
  preferring never-attempted.
- **Nothing** — read `local/drill-log.md` and pick by rust: never-attempted
  first, then longest since a clean solve, then anything solved at hint rung 3+.
  Say which and why in one line.

## Running

1. Reset if the working file already holds a past answer and he wants a clean
   attempt: `pnpm reset <problem>`. Ask first — re-reading his own old solution
   is legitimate spaced review.
2. Paste the contents of the problem's `README.md`. **Do not display its file
   path** — the path contains the pattern name, which is the answer to what
   the drill is testing recall of. **Say nothing else.** No framing, no
   encouragement, no "this one's a classic."
3. Start a timer. Note the wall-clock start.
4. **Ask for the brute force before he writes anything.** One question: "what's
   the obvious approach, and what does it cost?" Wait for an answer. Do not
   accept "I'll just go straight to the good one" — in a real interview,
   naming the naive approach and its complexity out loud is what buys you
   credit for the optimisation that follows, and skipping it reads as either
   luck or memorisation. Log what he said; do not evaluate it yet.
5. Wait. Do not comment on the attempt in progress.
6. On a hint request, advance exactly one rung. Never two.
7. When he says he's done, run `pnpm test <problem>`.

## On green

Ask for his time and space complexity **before** confirming. If he's wrong,
that's the finding — say so plainly and point at the line that costs more than
he thinks.

Then append one row to `local/drill-log.md`:

| Date | Problem | Pattern | Solved | Hints | Time | Note |

`Hints` is the highest rung reached (0–4). The note is one line on what actually
went wrong, not a grade. "Found the elimination pass, forgot to verify" is
useful. "Good job" is not.

## On red

Show the failing test names and nothing more.

**Distinguish the two kinds of red, explicitly, every time.** They mean opposite
things and conflating them teaches the wrong lesson:

- **Correctness tests red** — the answer is wrong. Keep going.
- **Correctness green, scale or budget red** — the answer is *right* and the cost
  isn't. Say exactly that: "this is correct, it's the brute force, and in an
  interview this is where you'd say 'that works, it's O(n²), let me do better'."
  A working brute force is a legitimate checkpoint and in a real interview it is
  often worth having on the board before you optimise. It is not the finish line
  for these twenty problems, because every one of them has a known better answer
  — which is exactly why they were chosen.

Do not describe a budget failure as a failed attempt. He got a working solution.

## If he gives up

Log it as unsolved at rung 4 and offer to re-queue it in a few days. Do not
soften it. An honest log is the only thing that makes `/status` worth reading.
