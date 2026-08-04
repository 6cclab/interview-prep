---
name: prep
description: Research a company's interview loop and seed drills for what they actually ask
---

# /prep &lt;company&gt;

Answer one question: **what will this company ask me?**

This is not `/company-research` in the job-search repo. That one answers *should I
work here* — org health, leadership stability, layoffs. This one is narrower and
adversarial: their loop, their rounds, their questions, and what I have not
drilled yet.

## Output

1. `local/companies/<name>.md` — the loop, round by round, with reported question
   patterns
2. Seeded problem directories under `problems/` for reported problems not already
   covered, tagged with the company in `meta.yaml`
3. A gap note — patterns they are reported to ask that have no drill yet

## Sourcing rules — read these before writing anything

Glassdoor and Blind are largely authentication-walled. Levels.fyi, Reddit,
LeetCode discuss, company engineering blogs, and the job posting itself are
reachable. Expect thin, dated, unevenly sourced results.

- **Every claim carries a source and a date.** Not "they ask system design" —
  "system design round reported, r/cscareerquestions, Nov 2024".
- **Mark confidence per item:** high (multiple independent dated reports, or
  first-hand), medium (one dated report), low (inference).
- **Never invent a reported question.** An empty section is a correct output. A
  plausible fabrication sends drilling in the wrong direction, which is worse
  than knowing nothing.
- **Label inference as inference.** "They are a Kotlin shop hiring at Staff, so
  expect a concurrency question" is a reasonable guess and must be written as a
  guess, in its own section, never mixed in with reports.
- Prefer recent sources. A 2019 loop description is close to worthless — note the
  age explicitly rather than quietly using it.
- If the whole search comes back empty, say so in one line and stop. Do not pad.

## Steps

1. **Read `local/config.yaml`.** If `job_search_path` is set and resolves, read
   `user/master-resume.md` for the gap note, and `user/research/<company>.md` if
   it exists — org research may already name teams, stack, or interviewers. If
   the path is unset or wrong, skip with a one-line note. Never error, never
   guess the path.
2. **Find the loop.** Recruiter screen, technical phone screen, take-home,
   onsite/virtual loop, number and length of rounds, who conducts each.
3. **Find the questions.** Coding problems by name where reported; system design
   prompts; behavioral themes. Cite each.
4. **Find the stack**, from the posting and the engineering blog. This drives the
   inference section and flags language gaps.
5. **Write `local/companies/<name>.md`** using the shape below.
6. **Seed drills.** For each reported coding problem with no existing drill, create
   `problems/<pattern>/<problem>/` following the structure of an existing problem
   directory: `README.md` (prompt only — **never name the pattern**), `stub.ts`,
   `solution.ts` (a copy of the stub), `solution.test.ts`, `meta.yaml` with the
   company tagged. Then write the worked answer to `solutions/<pattern>/<problem>.md`
   and add the problem to the matching row of `patterns.md`.

   Authoring a drill means proving its suite three ways before committing: it must
   fail a wrong solution, **fail a correct-but-brute-force solution**, and pass the
   reference. A suite a brute-force answer passes is broken. See
   `.claude/CLAUDE.md`.
7. **Write the gap note** at the end of the company file.

## File shape

```markdown
# <Company> — interview prep

_Researched YYYY-MM-DD. Sources and dates inline; confidence marked per item._

## Stack
## The loop
| Round | Format | Length | What they assess | Source | Confidence |
## Reported questions
### Coding
### System design
### Behavioral
## Inference (NOT reported — reasoned from stack and level)
## Gaps against my record
## Questions to ask them
```

## Close

End with the drills seeded, the patterns still undrilled, and **one** recommended
next action. Not a list.
