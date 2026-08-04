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
2. Print the problem's `README.md`. **Say nothing else.** No framing, no
   encouragement, no "this one's a classic."
3. Start a timer. Note the wall-clock start.
4. Wait. Do not comment on the attempt in progress.
5. On a hint request, advance exactly one rung. Never two.
6. When he says he's done, run `pnpm test <problem>`.

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

Show the failing test names and nothing more. A budget failure is not a wrong
answer — say explicitly that the output was right and the cost was not, since
that distinction is the whole point of the drill.

## If he gives up

Log it as unsolved at rung 4 and offer to re-queue it in a few days. Do not
soften it. An honest log is the only thing that makes `/status` worth reading.
