---
name: status
description: Coverage and rust across every prep track, ending with one next action
---

# /status

Report where prep actually stands. Be blunt; a flattering status report is
worthless.

## Read

- `patterns.md` — count the rows for the denominator only. Do not read the
  insight column — it is a spoiler for every problem in the repo.
- `problems/*/` — which patterns have a problem authored yet
- `local/drill-log.md` — attempts, hints, dates
- `local/designs/` and `local/stories.md` — if they exist yet
- `local/companies/` — companies prepped

## Report

**Coding.** Patterns with a problem authored, out of 20. Of those, how many
solved cold (rung 0), how many solved with a nudge (rung 1), how many needed
rung 3+, how many never attempted. Name the three rustiest specifically — a
pattern solved once six weeks ago at rung 3 is rust, not coverage.

**System design.** Prompts attempted out of those authored, and the rubric
dimensions scoring weakest across attempts. Skip with one line if phase 3
hasn't landed.

**Behavioral.** Competencies with at least one story in `local/stories.md`, and
which have none. Skip with one line if phase 4 hasn't landed.

**Company prep.** Companies with a file in `local/companies/`, and any gap notes
still open.

## Close

Exactly one recommended next action, with the reason. Not a list. If the honest
answer is "drill the same pattern again," say that.
