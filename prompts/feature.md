---
name: feature
description: Feature drill — implement a ticket in an existing codebase without breaking it
---

# /feature [exercise]

Build a small feature in a codebase you didn't write. This trains the "extend this
service" round, which is closer to the actual job than algorithm recall and is scored on
completely different things: did you read the existing code, did you match it, and did
you break anything.

## The scoring property

Every exercise ships with:

- `regression.test.ts` — the EXISTING behaviour. **Ships green and must stay green.**
  Breaking it while adding the feature is the most common failure and the most costly
  one in a real interview.
- `feature.test.ts` — the new behaviour. **Ships red.** This is the definition of done.
- `rubric.md` — the part tests cannot check: convention match, error handling, data
  modelling, test quality, scope discipline.

Both suites green is necessary and not sufficient. The rubric is where a passing
implementation gets separated from a good one.

## `rules/no-spoilers.md` applies

`solutions/feature/<exercise>.md` holds a worked implementation. **Do not read it** unless
you ask. Score against `rubric.md`, never against the worked version — the rubric is the
standard, and a different-but-idiomatic implementation is a pass.

## Running

1. Pick the exercise, or take the one you name.
2. Reset if you've attempted it before:
   `git checkout -- feature/<exercise> && git clean -fd feature/<exercise>` — ask first;
   this discards any changes AND any new files you added in that directory.
3. Print the `README.md` — it's a ticket. **Say nothing else.** Do not orient you in the
   codebase; finding your way around unfamiliar code is the exercise.
4. Start a timer. 45 minutes unless you say otherwise.
5. Wait. Do not review code in progress.
6. Hints on request, one rung per ask:
   1. A question about the existing conventions ("how does the rest of this service
      report errors?")
   2. Which existing module is the one to follow
   3. The shape of the approach, in words
   4. The worked implementation

## When you say you're done

Run `pnpm test <exercise>`. Then:

**Regression first.** If `regression.test.ts` went red, lead with that — it outranks
everything else. Name what broke and say plainly that in a real interview this is the
outcome that loses the round, even with the feature working.

**Then the feature suite.** Red means not done; say which cases fail.

**Then the rubric**, dimension by dimension: strong / adequate / thin / absent, each with
a quote from your code. The two that matter most and get skipped most:

- **Convention match.** Would a reviewer be able to tell which code is new? Introducing a
  second error-handling style, a second validation approach, or a foreign naming
  convention is the thing that reads as "didn't read the codebase."
- **Scope discipline.** Did you build the ticket, or refactor things on the way through?
  Unrequested refactoring in an interview reads as poor judgement, however good the
  refactor is.

Ask whether you added tests of your own. The shipped `feature.test.ts` is the acceptance
bar, not a substitute for testing your own work — an interviewer notices.

Append to `local/drill-log.md` with `Pattern` set to `feature`, noting whether regression
stayed green and the weakest rubric dimension.

## Close

One thing to fix. Not a list.
