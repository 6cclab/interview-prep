# Interview Prep

Andre's interview practice repo. Standalone — it does not depend on the
job-search repo, but links to it when configured.

He has not interviewed in ~5 years. The rust is pattern recall under pressure,
not coding ability. Everything here is built around that: bounded problem sets,
budget-enforcing tests, and rationed hints.

## Tracks

| Track | Location | Command | Status |
|---|---|---|---|
| Coding | `problems/`, `solutions/` | `/drill` | live |
| System design | `system-design/` | `/design` | phase 3 |
| Behavioral | `behavioral/`, `local/stories.md` | `/mock` | phase 4 |
| Company prep | `local/companies/` | `/prep` | live |

## Layout

- `problems/<pattern>/<problem>/` — `README.md` (prompt, **never names the
  pattern**), `stub.ts` (pristine), `solution.ts` (his working file),
  `solution.test.ts`, `meta.yaml`
- `solutions/<pattern>/<problem>.md` — worked answers. **Spoilers.** See
  `rules/no-spoilers.md`.
- `patterns.md` — pattern → tell → insight. Between-session reading.
- `local/` — gitignored. His drill log, designs, story bank, company research.
- `templates/local/` — committed seeds for `local/`, copied by `pnpm bootstrap`.

## Commands

```bash
pnpm bootstrap          # seed local/ (idempotent, never overwrites)
pnpm test <problem>     # run one drill
pnpm test               # everything, as a regression check
pnpm reset <problem>    # restore stub.ts over solution.ts
pnpm typecheck
```

## Tests encode the insight

A drill is only worth doing if a **correct but brute-force** solution fails it.
Where a problem exposes an expensive oracle, wrap it with `countCalls` from
`test-utils/oracle.ts` and assert a budget with `assertWithinBudget`. Where no
oracle exists, use a large-N case under the 10s timeout.

When authoring a new problem, prove the suite three ways before committing: it
must fail a wrong solution, fail a brute-force solution, and pass the reference.
A suite a brute-force answer passes is broken, whatever the reference does.

## job-search link

`local/config.yaml` may set `job_search_path`. When present, commands may read
(never write):

- `user/master-resume.md` — the record `/prep` writes gap notes against
- `user/communication-style.md` — critique rubric for behavioral answers
- `user/research/<company>.md` — existing org research

When absent or wrong, skip the step with a one-line note. Never error, and never
guess the path.

## Tone

Andre's three standing rules, kept in job-search and applied here to any drafted
answer: first-person and conversational rather than third-person corporate;
never compliment a company by implying his current org is worse; answer the
question asked instead of pitching a project.
