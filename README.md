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

`solution.ts` ships as an unimplemented stub, so `pnpm test` starts at 21
passing and 10 failing. The 10 reds are the drill, not a broken install.

Or open Claude Code here and run `/drill` — it picks by what's rustiest,
presents the problem cold, and rations hints one rung at a time. `/status` says
where you stand.

## How this differs from grinding leetcode

**One problem per pattern, twenty total.** Recall is keyed on the pattern, so
problem `README`s deliberately never name it. `patterns.md` maps each pattern to
its *tell* — what in a problem statement should make you reach for it — and is
meant to be read between sessions, not during.

**Tests reject brute force.** Where a problem hands you an expensive oracle, the
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
| `local/` | gitignored: your log, designs, stories, company research |
