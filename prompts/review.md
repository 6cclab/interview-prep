---
name: review
description: Work through a drill you have already finished — the answer, why it works, and what to look for next time
---

# /review [problem]

The debrief. This is the one command that is allowed to show you the answer,
because it only ever runs **after** a drill is over.

`rules/no-spoilers.md` says never to read `solutions/**` "unless Andre
explicitly asks to see the answer." Invoking this *is* that request. Everything
else in that file still holds — most of all: nothing here may run during an
attempt.

## The gate, first

Before reading anything, establish that the drill is finished. In order:

1. If no problem was named, take the most recent row in `local/drill-log.md`
   and confirm it with him: "reviewing <problem>, from <date> — right?"
2. If a problem was named, find its row in `local/drill-log.md`.
3. **No row means no finished attempt.** Say so and stop:

   > There's no logged attempt at `<problem>`. Reviewing it now would burn the
   > drill. Run `/drill <problem>` first — or say "review it anyway" if you
   > genuinely want the answer without attempting it.

   If he says review it anyway, that is his call to make. Note in the log that
   the problem was reviewed unattempted, so `/status` does not later count it as
   coverage it never earned.

4. **If a session is currently open, stop.** Check for a transcript in
   `local/drills/` with no matching drill-log row, and ask outright whether the
   drill is finished. A review delivered mid-attempt is indistinguishable from
   rung 4 arriving uninvited.

## Read

- `problems/<pattern>/<problem>/README.md` — the prompt
- `solutions/<pattern>/<problem>.md` — the worked answer. **This is the only
  command permitted to open this file.**
- `problems/<pattern>/<problem>/solution.ts` — what he actually wrote
- `problems/<pattern>/<problem>/solution.test.ts` — how the suite forces the
  insight, which is often the most useful part of the debrief
- the row in `local/drill-log.md` — hints taken and time, which set the tone
- the transcript in `local/drills/`, if the drill was spoken

Do **not** read `patterns.md`. Its insight column states the answer to every
other problem in the repo, and this review is about one.

## Report

Five parts, in this order. Keep it to what is useful; this is a debrief, not a
lecture.

**1. What the answer is.** State it plainly and completely. He has asked. Do not
ration anything at this point — rationing is the drill's job and the drill is
over.

**2. Why his attempt landed where it did.** Read `solution.ts` and say what it
actually does, then name the specific gap between that and the answer. "You had
the elimination pass and never verified the survivor" is useful. "You were close"
is not. If he solved it cold, say so and skip to part 4 — there is no gap to
explain and inventing one is worse than saying nothing.

**3. The tell.** What in the problem statement should have pointed here, phrased
so he can recognise it in a problem he has not seen. This is the part that
transfers; the answer itself does not. Draw it from the prompt's own wording —
the expensive oracle, the sorted input, the "return any valid order" — not from
the pattern name.

**4. What the suite was testing.** Read `solution.test.ts` and say which
mechanism it used — an oracle budget or a scale test — and what a brute force
does against it. Knowing *why* the cost test exists is what makes the next
"correct but too slow" verdict legible instead of annoying.

**5. One thing to do next.** A single action. Re-drill this in a few days,
or drill a named neighbouring problem, or nothing at all if the solve was clean.
Not a list.

## After

Offer to re-queue: `pnpm reset <problem>` restores the stub, and a re-drill in a
few days on a problem reviewed today is the honest test of whether the review
landed. Do not run the reset yourself without being asked — his working file is
his.

Do not append to `local/drill-log.md`. The row for the attempt is already there
and a review is not another attempt; adding one would inflate the count
`/status` reads.

## Tone

`AGENTS.md`'s three rules apply. Beyond them, one more that is specific
to this command: he got here by finishing something, and often by not solving it.
Do not open with reassurance and do not grade. Say what the answer is and what
the gap was, in his own terms, and let the facts be the feedback.
