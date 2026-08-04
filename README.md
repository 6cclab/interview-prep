# Interview Prep

Practice repo for coding drills, system design, and behavioral prep. Standalone —
job-search is optional.

## Setup

```bash
pnpm install
pnpm bootstrap  # seeds gitignored local/
```

Then edit `local/config.yaml` if the job-search repo isn't at `~/job-search`, or
delete the line if it isn't on this machine.

## Drilling

```bash
pnpm test celebrity     # attempt the drill
pnpm reset celebrity    # start over from a clean stub
pnpm test               # everything, as a regression check
```

**A fresh clone starts with a mostly-red suite, on purpose.** Every drill ships
unsolved and every debugging exercise ships broken — that is the product, not a
failed install. Right now `pnpm test` reports 65 passing and 211 failing, made up
of:

- 177 coding-drill failures and 14 feature-stub failures, all throwing
  `not implemented`
- 20 assertion failures — 9 in the debugging exercises, where the planted bug is
  real code doing the wrong thing, and 11 in the feature exercises, where the
  behaviour is unbuilt rather than unimplemented
- the only suites that ship **green** are the harness tests and each feature
  exercise's `regression.test.ts` — if either of those goes red, something is
  genuinely wrong

Run `pnpm test <exercise>` to work on one at a time; the full run is a status
check, not a health check.

Or open Claude Code here and run `/drill` — it picks by what's rustiest,
presents the problem cold, and rations hints one rung at a time. `/status` says
where you stand.

## How this differs from grinding leetcode

**One problem per pattern, twenty total.** Recall is keyed on the pattern, so
problem `README`s deliberately never name it. `patterns.md` maps each pattern to
its *tell* — what in a problem statement should make you reach for it — and is
meant to be read between sessions, not during.

**Tests separate correct from optimal.** Where a problem hands you an expensive oracle, the
suite counts calls and asserts a budget. Celebrity caps `knows()` at `3n`, so an
O(n²) solution returning the right person still fails. Green means you found the
insight, not that the output matched.

**Hints are rationed, not withheld.** Four rungs — nudge, pattern name, approach,
full solution — one per request. The log records which rung you reached, because
a solve at rung 3 and a cold solve are different facts.

## Layout

| Path | What |
|---|---|
| `problems/<pattern>/<problem>/` | prompt, stub, your working file, tests |
| `solutions/` | worked answers — spoilers, read deliberately |
| `patterns.md` | pattern → tell → insight |
| `system-design/` | prompts, rubrics, and worked references |
| `behavioral/` | competency map and question bank |
| `debugging/` | planted-bug exercises; find the root cause, not the symptom |
| `feature/` | build a ticket in an existing service without breaking it |
| `local/` | gitignored: your log, designs, stories, company research |
