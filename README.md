# Interview Prep

Practice repo for coding drills, system design, and behavioral prep. Standalone —
job-search is optional.

**It works without a language model.** The grader is the test suite, the
exercises are static files, and `pnpm drill` runs a full drill — cold problem,
brute-force question, rationed hints, cost-vs-correctness verdict, logged
attempt — with no key, no network and no model. A model adds the conversational
tracks; it is not the price of entry. See [Without a model](#without-a-model).

## Setup

```bash
pnpm install
pnpm bootstrap  # seeds gitignored local/
```

Then edit `local/config.yaml` if the job-search repo isn't at `~/job-search`, or
delete the line if it isn't on this machine.

## Drilling

```bash
pnpm drill              # a full drill, no model required
pnpm drill two-pointers # or a named problem or pattern
pnpm test celebrity     # just the suite, if you'd rather drive yourself
pnpm reset celebrity    # start over from a clean stub
pnpm test               # everything, as a regression check
```

**A fresh clone starts with a mostly-red suite, on purpose.** Every drill ships
unsolved and every debugging exercise ships broken — that is the product, not a
failed install. `pnpm test` currently reports **839 passing and 292 failing**,
almost all of the failures being coding drills and feature stubs throwing
`not implemented`, plus assertion failures in the debugging exercises where the
planted bug is real code doing the wrong thing.

The suites that ship **green** are the harness tests and each feature exercise's
`regression.test.ts`. If either of those goes red, something is genuinely wrong.

Run `pnpm test <exercise>` to work on one at a time; the full run is a status
check, not a health check.

With Claude Code open here, `/drill` does the same thing conversationally and
`/status` says where you stand.

## Without a model

Everything below runs on Node and pnpm alone:

| Works with no model | How |
|---|---|
| Coding drills | `pnpm drill` — selection by rust, cold prompt, brute-force question first, one hint rung per request, correctness-vs-cost verdict, logged row |
| Debugging exercises | `repro`/`invariant` suites are the whole grader |
| Feature exercises | `regression` ships green, `feature` ships red and defines done |
| Every exercise's content | prompts, rubrics, worked solutions, `patterns.md` |

**Two of the four hint rungs need no authoring at all**, which is why the runner
is useful immediately: rung 2 is the pattern name, which is `meta.yaml`'s
`pattern:` field, and rung 4 is the worked solution under `solutions/`. Rungs 1
and 3 are authored per problem as `hints.nudge` and `hints.approach` in
`meta.yaml`, alongside an optional `complexity:` block:

```yaml
hints:
  nudge: Which end of the range can you rule out, and why?
  approach: Walk inward from both ends, moving whichever side is smaller.
complexity:
  time: O(n)
  space: O(1)
```

An unauthored rung **says so** rather than silently serving the next one up — one
request must never buy two rungs of help.

What a model still buys you: the spoken design and behavioural interviews, which
need something that asks the next question, and any judgement of prose (whether
your brute-force answer was right, whether your stated complexity is actually
correct). `pnpm drill` records those and leaves the assessment to you — a scripted
opinion you cannot argue with would teach the wrong thing.

## Portability

The core is plain TypeScript on Node — no platform assumptions, no network.

**The spoken tracks are macOS-only today.** `voice/speech.ts` shells out to `say`
for text-to-speech, `voice/audio.ts` records through ffmpeg's `avfoundation`, and
`voice/devices.ts` enumerates devices through both. Porting them means one audio
backend abstraction (record, speak, list devices) with an ALSA/PulseAudio and
`espeak`/`piper` implementation behind it. Nothing else in the repo cares.

Model backends, when you do want one, are per track and explicit — a Claude
subscription, the Anthropic API, or a local ollama model. See
`.claude/CLAUDE.md` under "Which model the interviewer runs on".

## How this differs from grinding leetcode

**Thirty problems across twenty-one patterns**, most patterns carrying exactly
one. Recall is keyed on the pattern, so
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

## License

MIT. See [LICENSE](LICENSE).
