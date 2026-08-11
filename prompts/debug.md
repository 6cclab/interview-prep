---
name: debug
description: Debugging drill — a planted bug in unfamiliar code, scored on root cause vs symptom patch
---

# /debug [exercise]

Find the bug in an unfamiliar codebase. This trains the "here's some code, something's
wrong with it" round, which is a different skill from algorithm recall — it is reading
code you didn't write, forming a hypothesis, and testing it.

## The scoring property

Every exercise ships with two failing suites:

- `repro.test.ts` — reproduces the reported symptom. **A symptom patch makes this pass.**
- `invariant.test.ts` — a different path with the same underlying defect. **Only fixing
  the root cause turns this green.**

Green on `repro` alone means you patched the symptom. That is the finding, and it is the
whole point of the exercise — say it plainly rather than congratulating a partial fix.

## `rules/no-spoilers.md` applies

`solutions/debugging/<exercise>.md` names the root cause. **Do not read it** unless you
explicitly ask. Do not read the source files looking for the bug so you can steer the
candidate toward it — you are running the exercise, not solving it.

## Running

1. Pick the exercise, or take the one you name. If you don't name one, pick from
   `local/drill-log.md` favouring never-attempted.
2. Reset first if you've attempted it before:
   `git checkout -- debugging/<exercise> && git clean -fd debugging/<exercise>` — ask
   first, since this discards any changes AND any new files you added in that
   directory, and re-reading your own past fix is legitimate review.
3. Paste the contents of the `README.md` — it's a bug report. **Do not display its file
   path** — the path contains the exercise name, which is the answer. **Say nothing
   else.** No orientation, no "have a look at the resolver."
4. Start a timer.
5. **Before you change any code, ask for a hypothesis.** One question: "what do you think
   is happening, and what would prove it?" This is the actual interview behaviour —
   changing lines until the test goes green is what junior candidates do, and it is
   visible. Log what you said.
6. Wait. Do not comment on the investigation in progress.
7. Hint ladder, on request only, one rung per ask:
   1. A question about where the behaviour diverges from expectation
   2. Which module the defect lives in
   3. The nature of the defect, in words
   4. The root cause and the fix

## When you say you're done

Run `pnpm test <exercise>`, then report against these three, in order:

**Root cause or symptom?** Both suites green means root cause. `repro` green and
`invariant` red means a symptom patch — say so directly, and ask what the two failing
paths have in common. Do not soften this; shipping a symptom patch is the exact failure
the exercise exists to catch.

**Was the hypothesis right?** Compare what you predicted in step 5 to what it turned out
to be. A wrong hypothesis that was cheaply disproven is fine — better than no hypothesis.

**Is the fix in the right place?** A correct fix duplicated into three call sites is
worse than one in the shared path. Ask where else this defect could reappear.

Then append to `local/drill-log.md` with `Pattern` set to `debugging`, and a note saying
whether it was root cause or symptom on the first attempt.

## Close

One thing to carry into the next one. Not a list.
