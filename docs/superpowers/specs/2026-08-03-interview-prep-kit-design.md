# Interview Prep Kit — Design

**Date:** 2026-08-03
**Status:** Approved, ready for planning

## Problem

Andre has been at LegalZoom ~4.5 years and has not interviewed in roughly five. The
rust is specific and diagnosable, not general:

- **Pattern recall under pressure.** Toast asked the celebrity problem in a prior
  conversation and it did not go well. That is not a coding failure. The insight —
  one `knows()` comparison eliminates one candidate permanently, so a single pass
  finds a candidate and a second verifies it, O(n) instead of O(n²) — is either
  present or absent within the first two minutes. Grinding volume does not fix
  this; drilling one canonical problem per *pattern* does.
- **No system design reps.** He has shipped designs worth discussing (LaunchDarkly
  Relay Proxy, a DX observability pipeline, a BFF deprecation) but has never had to
  present one under interview conditions to a stranger on a clock.
- **No story bank.** Staff loops weight behavioral heavily. The raw material exists
  in `master-resume.md` in near-STAR form; it has never been organized by the
  competency each story answers.

A referral attempt at Toast is likely. All seven live applications in job-search are
cold portal submissions with zero responses, so a warm channel is a meaningful
change and worth being ready for.

## Non-goals

- **Java/Kotlin refresher.** Toast's backend is Java/Kotlin and it is the genuine
  gap in Andre's record, but closing it is a separate effort with a different shape.
  Explicitly cut.
- **Org-health research on Toast.** job-search's existing `/company-research`
  already owns "should I work here." This kit owns "what will they ask me."
- **Leetcode volume.** Andre's stated position is that he dislikes leetcode. A
  finishable set he completes beats a comprehensive set he abandons. The coding
  track is deliberately bounded at roughly twenty problems.

## Architecture

### Standalone repo, loosely coupled to job-search

The kit is its own git repository at `~/projects/interview-prep`, not a directory
inside job-search. Andre can open it alone and practice without job-search in
context. The two projects reference each other through configuration, and **both
directions are optional** — a missing or unconfigured path degrades to a skipped
step with a note, never an error.

- `job-search/user/config.yaml` gains `interview_prep_path: ~/projects/interview-prep`
- `interview-prep/local/config.yaml` holds `job_search_path: ~/job-search`

This buys two things. `/prep <company>` can read
`job-search/user/master-resume.md` to write its gap note against Andre's actual
record rather than against nothing, and can cross-reference
`job-search/user/research/<company>.md` when org research already exists.
Conversely, job-search-side commands can observe drill progress without owning any
of it.

The coupling is read-only in both directions. Neither project writes into the other,
with one exception: the one-line `interview_prep_path` addition to job-search's
config, made once at the end of the build.

### Layout

```
~/projects/interview-prep/
  .claude/
    CLAUDE.md                      # loaded every session in this dir
    commands/
      drill.md  design.md  mock.md  prep.md  status.md
    rules/
      no-spoilers.md               # hard gate
    settings.json                  # pre-allow pnpm/vitest
  package.json  pnpm-lock.yaml  vitest.config.ts  tsconfig.json
  README.md
  patterns.md                      # the pattern spine — between-session review
  problems/<pattern>/<problem>/
    README.md                      # prompt, constraints, examples
    stub.ts                        # pristine signature
    solution.ts                    # working file
    solution.test.ts               # fails until correct
    meta.yaml                      # pattern, difficulty, companies[], source
  solutions/<pattern>/<problem>.md # worked answer + why + complexity + variants
  system-design/<problem>/
    README.md  rubric.md  reference.md
  behavioral/
    competencies.md  questions.md
  docs/superpowers/specs/
  local/                           # gitignored
    config.yaml
    drill-log.md
    designs/<problem>.md
    stories.md
    companies/<name>.md
```

Everything outside `local/` is generic and committed — a repo that could be
published later without redacting anything. Everything personal (attempts, scores,
story bank, company research) lives in `local/` and is gitignored.

Andre's own `solution.ts` edits are committed. Seeing a past solution during spaced
review is legitimate; `pnpm reset <problem>` restores `stub.ts` over it when a clean
re-drill is wanted.

### `.claude/` is the integration point

`.claude/CLAUDE.md` is loaded on every session opened in this directory, which means
the no-spoiler rule and config resolution apply whether Andre invokes a command or
simply says "give me a problem." The commands are thin entry points; the durable
behavior lives in `CLAUDE.md` and `rules/no-spoilers.md`.

`rules/no-spoilers.md` follows the same shape as job-search's
`.claude/rules/job-eval-gate.md` — a short, absolute constraint stated as a gate:

- Never volunteer a solution, an approach, or a pattern name, including when the
  reader can see the attempt heading somewhere wrong.
- Never read from `solutions/` or `system-design/*/reference.md` into context unless
  Andre explicitly asks to see the answer.
- Advance exactly one hint rung per request. Never two.

`settings.json` pre-allows `pnpm test`, `pnpm reset`, and `vitest` so a permission
prompt never interrupts a timed drill.

## Track 1 — Coding

Roughly twenty problems, one canonical problem per pattern. The organizing claim is
that recall should be keyed on the pattern, not on the problem. `README.md`
therefore states the prompt, constraints, and examples but deliberately **omits the
pattern name** — naming it would test reading rather than recall. `patterns.md` maps
pattern → tell → insight and is the artifact reviewed *between* sessions.

The twenty patterns, fixed here so the set is finishable rather than open-ended:

two pointers · fast/slow pointers · sliding window · hashmap counting ·
prefix sums · in-place array manipulation · binary search on answer ·
intervals · monotonic stack · heap / top-k · adversarial elimination ·
binary tree recursion · BFS/DFS on a grid · graph shortest path ·
topological sort · union-find · trie / prefix matching · backtracking ·
1-D dynamic programming · string parsing with a stack

Celebrity lives under `elimination` alongside majority-element, which shares the
insight: one comparison permanently removes a candidate from contention.

### Tests encode the insight, not just the answer

This is the distinguishing design decision and the reason the kit is not simply
leetcode with extra steps. A test suite must **fail a correct-but-brute-force
solution**.

- Where the problem exposes an oracle, instrument it. Celebrity's `knows()` is
  wrapped in a call counter and the suite asserts `≤ 3n` calls, so an O(n²) solution
  returning the right person still goes red.
- Where no oracle exists — two pointers, binary search — a large-N case with a
  timeout serves the same purpose.

Green therefore means the insight was found, not merely that the output matched.

### Commands

```
pnpm test <problem>     # one drill
pnpm test               # everything solved so far, as a regression check
pnpm reset <problem>    # stub.ts -> solution.ts, re-drill clean
```

`pnpm reset` is a small script that copies `stub.ts` over `solution.ts`. No git
manipulation.

### The hint ladder

`/drill` takes a problem, a pattern, or nothing. Given nothing, it selects from
`local/drill-log.md`, favoring never-attempted problems and those longest since
passed. It then shows `README.md` and says nothing further.

When Andre asks for help, he receives **exactly one rung**:

1. A nudge, phrased as a question, that does not name the pattern
2. The pattern name
3. The approach in words, no code
4. The full worked solution

"Show me" jumps straight to rung four. Nothing is volunteered at any point.

On green, `/drill` asks Andre to state the time and space complexity **before**
confirming correctness, then appends to `local/drill-log.md`: date, problem, solved
or not, hints used, elapsed time, and a note. Hints used and time are the honest
signal of fluency; pass/fail is not.

## Track 2 — System design

Six prompts. The rubric plays the role the instrumented test plays for coding: it is
the objective standard the attempt is measured against, committed alongside the
prompt.

Each prompt directory holds:

- `README.md` — the prompt and its constraints
- `rubric.md` — dimensions a strong answer covers: requirements clarification,
  back-of-envelope estimation, API surface, data model, scale path, failure modes,
  and explicit tradeoffs
- `reference.md` — a worked design, off-limits under `no-spoilers.md` until asked
  for

Four prompts are canonical: rate limiter, notification fanout, metrics/telemetry
pipeline, multi-tenant feature flags.

Two are drawn from systems Andre actually built, restated as generic prompts: the
LaunchDarkly Relay Proxy as *design a flag delivery system that survives vendor
outages*, and the DX observability platform as *design a developer telemetry
pipeline*. These serve double duty as deep-dive-round preparation, where he is the
expert rather than reasoning from first principles about someone else's problem.

`/design <problem>` reviews `local/designs/<problem>.md` against the rubric, scoring
per dimension and pushing specifically on thin sections rather than offering a
better design. `/design <problem> --live` instead runs it as a timed conversation,
saving the transcript and a post-mortem to `local/designs/`.

## Track 3 — Behavioral

`behavioral/competencies.md` is the committed competency map: conflict, failure,
influence without authority, operating under ambiguity, mentoring, disagreement with
a decision, and the staff-scope competencies (setting direction, escalating a
pattern rather than patching an instance). `behavioral/questions.md` is a bank of
question phrasings per competency.

`local/stories.md` is the personal STAR bank, seeded from job-search's
`master-resume.md` and tagged by which competency each story answers. Several
entries are already close to STAR form — the Guardian entitlement default-to-entitled
bug, the parity-judgement escalation to the PM, the service-level unification across
three domains, and the systemic escalation of missing error and loading treatment to
the design system owners.

`/mock behavioral` asks one question cold, with no warning, then critiques the answer
against Andre's three recorded tone rules, read from job-search when configured:
first-person, warm, and conversational rather than third-person corporate; never
compliment a target company by implying the current or previous org is worse; answer
the question asked rather than pitching a project. These are existing, deliberate
rules and the critique rubric should cite them by name.

## Track 4 — `/prep <company>`

Distinct from job-search's `/company-research`. Output:

1. `local/companies/<name>.md` — loop structure, round by round, reported question
   patterns, **each carrying its source and date**
2. Seeded problem directories under `problems/` for reported problems not already
   covered, tagged with the company in `meta.yaml`
3. A gap note: patterns this company is reported to ask that Andre has not drilled,
   written against `master-resume.md` when `job_search_path` is configured

**Stated limitation, to be reproduced in the command file itself.** Glassdoor and
Blind are largely authentication-walled. Results will be thin, dated, and unevenly
sourced. `/prep` marks a confidence level per item and **must not invent a reported
question**. An empty section is a valid and correct output; a plausible fabrication
is not. Where a question cannot be attributed to a dated source, it is labeled as
inference from the company's stack and role level, not as a report.

## Track 5 — `/status`

Reads `local/drill-log.md`, `local/designs/`, and `local/stories.md` and reports
coverage and rust across all three tracks, ending with a concrete next action.

## Phasing

Ordered so the kit becomes usable before it is complete.

1. **Scaffold.** Repo, `.claude/` (CLAUDE.md, five commands, no-spoilers rule,
   settings.json), pnpm + Vitest + TypeScript, `README.md`, `patterns.md`, the
   `pnpm reset` script, and the celebrity problem end to end including its
   instrumented `knows()` counter. Drillable the day it lands.
2. **Coding track.** The remaining nineteen or so problems, one per pattern.
3. **System design track.** Six prompts with rubrics and references.
4. **Behavioral track.** Competency map, question bank, and the seeded story bank.
5. **Toast.** Run `/prep toast`, then add `interview_prep_path` to
   `job-search/user/config.yaml`.

## Testing

The coding track's harness tests itself: each `solution.test.ts` is validated by
confirming it fails against both a deliberately wrong solution and a
correct-but-brute-force one, and passes against the reference. That check is part of
authoring a problem, not an afterthought — a suite that a brute-force solution passes
is a broken suite regardless of whether the reference passes it.

`pnpm reset` gets a test confirming it restores `stub.ts` byte-for-byte.

The system design and behavioral tracks have no executable tests; their rubrics are
the standard, and correctness there is a review question.

## Risks

- **`/prep` fabricating interview questions.** The highest-severity failure in the
  kit: a confidently reported question that nobody ever asked sends drilling in the
  wrong direction. Mitigated by mandatory source-and-date attribution, explicit
  confidence marking, and permitting empty output.
- **Spoiler leakage.** A command or a stray file read that pulls `solutions/` into
  context destroys the drill before it starts. Mitigated by `rules/no-spoilers.md`
  as a hard gate and by keeping worked solutions in a directory no command reads by
  default.
- **Abandonment.** Andre dislikes leetcode and has said so. Mitigated by the bounded
  problem set, by phase 1 being independently useful, and by logging hints and time
  rather than a pass/fail score that punishes honest attempts.
