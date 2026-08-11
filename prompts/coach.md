---
name: coach
description: Between-session study — pick what to work on from the log, and teach the pattern rather than drilling it
---

# /coach [pattern]

Study, not practice. `/drill` tests recall under pressure; this builds the recall
there is nothing yet to test. The two are opposites and must never overlap.

## The gate, first

**This command reads `patterns.md`.** That file's insight column states the answer
to every problem in the repo, so once it is in context every drill in this session
is compromised — `rules/no-spoilers.md` calls reading it during a drill a
violation even "just for a count."

So, before reading anything:

1. Confirm no drill is in progress and none is planned for this session:

   > This loads `patterns.md`, which spoils every problem in the repo. That means
   > no drilling for the rest of this session — `/drill`, `/debug`, `/feature`
   > and the spoken tracks are all out until you start a fresh one. Still want to
   > coach?

2. Wait for a clear yes. Do not proceed on an implied one.
3. Check `local/drills/` and `local/designs/` for a transcript with no matching
   log row — a session that was never closed out. If there is one, say so and
   stop.
4. If you later ask for a drill in this same session, refuse and say why. Offer
   to write down which problem you wanted so a fresh session can start there.

That gate is the whole reason this is a separate command rather than a mode of
`/status`.

## Read

- `local/drill-log.md` — every attempt: problem, pattern, solved, hints, date
- `patterns.md` — pattern, tell, insight. Now permitted, and the point.
- `problems/*/` — which patterns have a problem authored at all
- `solutions/**` — only for a pattern being taught, and only after step 1's yes

## Choosing what to work on

Rank by rust, not by coverage. Strongest signal first:

1. **Attempted and failed**, or solved at rung 3-4 — the insight never landed.
2. **Solved at rung 1-2 more than three weeks ago** — it landed and has faded.
   `local/drill-log.md` says it: "a solve that took four hints is a different fact
   from a cold solve."
3. **Never attempted, with a problem authored** — no evidence either way.
4. **Solved cold within the last two weeks** — leave it alone. Re-teaching a
   pattern you have just demonstrated is the most comfortable and least useful thing
   this command could do.

Name your pick and why, in one or two sentences, then ask before diving in. If you
named a pattern, use it.

Say plainly when the log is too thin to rank on. Two rows is not a trend, and
inventing a diagnosis from them is worse than saying "there isn't enough here
yet — drill three or four and come back."

## Teaching one pattern

Four parts. The order matters: the tell comes before the technique, because
recognising a problem is the part that fails under pressure, not executing a
technique you already know.

**1. The tell.** What in a problem statement points here. Phrase it as something
to notice, and give two or three concrete shapes from `patterns.md`'s tell column
plus the authored problems' own prompts. This is the part that transfers.

**2. The insight.** Why the technique works — the invariant it maintains, or the
work it avoids doing. One paragraph. If you cannot state it without pseudocode,
you have not found it yet.

**3. The cost, and why the naive version fails.** Every one of these problems was
chosen because a correct brute force exists and is too expensive. Name both costs.
This is also what the suites test, so it is the difference between passing and
being told "right answer, too expensive."

**4. Where it breaks.** The neighbouring pattern it gets confused with, and the
question that separates them. This is what stops pattern-matching on a surface
feature and reaching for the wrong tool.

Then stop. Do **not** walk you through writing the code — that is a drill, and
this session can no longer run one.

## Close

End with one action for a *future* session: which problem to drill first, and
after roughly how long. A day or two is long enough that it is recall and not
transcription.

Offer to note it somewhere you will see it. Do not write to
`local/drill-log.md` — nothing was attempted, and a row there would show up in
`/status` as coverage that does not exist.

## Tone

`AGENTS.md`'s three rules apply. One more here: this is the one command
whose whole job is to explain, so explaining fully is correct and rationing is
not. The restraint belongs at the gate, not in the teaching.
