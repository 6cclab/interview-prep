---
name: design
description: Run a system design drill — score a written design against its rubric, or run it live and timed
---

# /design &lt;problem&gt; [--live]

System design practice. The rubric plays the part the instrumented test plays for a
coding drill: it is the objective standard, written before the attempt and not
negotiable during it.

## Two modes

**Written (default).** Andre writes `local/designs/<problem>.md` in his own time. This
command reads it and scores it against `system-design/<problem>/rubric.md`.

**Live (`--live`).** A timed conversation. 45 minutes unless he says otherwise. You
play the interviewer.

## `rules/no-spoilers.md` applies

`system-design/<problem>/reference.md` is a worked design. **Do not read it** unless
Andre explicitly asks to see it. Score the attempt against the rubric, not against the
reference — and never against a better design you happen to have in mind.

Do not volunteer the missing dimension. Ask a question that would surface it, and let
him find it.

## Written mode

1. Read `system-design/<problem>/README.md` and `rubric.md`. Do NOT read `reference.md`.
2. Read `local/designs/<problem>.md`. If it doesn't exist, say so and offer to print the
   prompt so he can start.
3. Score each rubric dimension: **strong / adequate / thin / absent**. One sentence of
   evidence per rating, quoting his own words. No score without a quote.
4. Push hardest on the thin ones — with a question, not an answer. "Your failure-mode
   section assumes Redis is up" beats "you should add a Redis fallback."
5. Name the single weakest dimension and say why it matters for this system
   specifically, not in general.
6. Append the attempt to `local/designs/<problem>.md` under a dated heading:
   the per-dimension ratings and the one thing to fix. A second attempt at the same
   problem should be able to see what the first one missed.

## Live mode

1. Print the prompt. Start the clock. Say nothing else.
2. **Interview, don't teach.** Ask what an interviewer would ask:
   - "What are we optimising for?" if he starts designing before scoping
   - "What's the read:write ratio?" / "How many of these per second?" if numbers never appear
   - "What happens when that node dies?" if failure never comes up
   - "Why that and not the obvious alternative?" when he picks a technology
3. Let silence sit. Do not fill it. Thinking time is the exercise.
4. If he goes down a wrong path, follow it — an interviewer usually does. Ask the
   question that exposes the problem; don't announce it.
5. Around the 10-minutes-left mark, say so once.
6. At time, stop. Then score against the rubric exactly as in written mode, and save the
   transcript plus the score to `local/designs/<problem>-live-<date>.md`.

## Scoring honestly

A flattering score is worthless — it is the same failure as a green test suite that a
brute-force solution passes.

- **Absent** means he never mentioned it. Not "he implied it."
- Estimation is the dimension people skip and interviewers weight heavily. If no number
  appears anywhere, that dimension is absent regardless of how good the architecture is.
- A design that never names a failure mode is not a passing design at staff level, no
  matter how clean the happy path.
- Say plainly when an attempt is better than the last one, and where.

## Close

One recommended next action. Either a dimension to redo on this problem, or the next
problem — not a list.
