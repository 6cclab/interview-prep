# Interview Prep

Practice repo for coding drills, system design, and behavioral prep. Standalone —
job-search is optional.

**It works without a language model.** The grader is the test suite, the
exercises are static files, and `pnpm drill` runs a full drill — cold problem,
brute-force question, rationed hints, cost-vs-correctness verdict, logged
attempt — with no key, no network and no model. A model adds the conversational
tracks; it is not the price of entry. See [Without a model](#without-a-model).

## What you need

| | |
|---|---|
| Node + pnpm | `pnpm@10.28.0` (the `packageManager` field pins it) |
| ffmpeg | required by every spoken track — transcoding and playback |
| whisper.cpp | `whisper-cli` plus a ggml model; `WHISPER_BINARY` and `WHISPER_MODEL` override the paths |
| A TTS engine | macOS `say`, or `piper` on any platform. `SAY_ENGINE` chooses; the default follows your OS |
| A model backend | one of: the `claude` CLI logged in, an Anthropic API key, an OpenAI-compatible endpoint, or ollama |

**Platform support is not uniform, and it is worth knowing which half you are in:**

- **The browser tracks** (`pnpm mock:web`) run anywhere. Audio is captured by the
  browser and transcoded server-side by ffmpeg with no platform-specific flags.
- **The terminal tracks** (`pnpm mock:voice`, `pnpm design:voice`) are macOS-only.
  They capture audio through ffmpeg's `avfoundation`, which does not exist
  elsewhere. There is no fallback and they will fail immediately on Linux.

Use Chrome for the browser tracks. Firefox works; Safari and Arc do not without
HTTPS — see the browser table in `AGENTS.md`.

### Choosing a backend

There is no default. Run one of:

```bash
pnpm mock:web:claude   # the claude CLI, spending subscription quota
pnpm mock:web:openai   # any OpenAI-compatible endpoint (OPENAI_API_KEY, OPENAI_BASE_URL)
pnpm mock:web:ollama   # a local model, spending nothing
pnpm mock:web:hybrid   # behavioural local, the rest on Claude
```

`pnpm mock:web` with nothing set fails and prints this list. That is deliberate:
a transport you did not choose is one you discover mid-drill.

**piper is unverified on this machine — no audio has been produced by it.** The
flags the code builds (`--output_raw`, `--model`, `--length_scale`) match what a
real `piper --help` accepts, and a real voice model's config declares
`"sample_rate": 22050`, matching what the code passes to `ffplay`. But
`piper-tts` on Python 3.14 has a broken espeak data path — it looks for
`site-packages/piper//phontab` while the data ships in
`piper/espeak-ng-data/`, and `ESPEAK_DATA_PATH` is ignored — so an end-to-end
run was never achieved on this machine. If you are on Linux, you are its first
real test; report back what you find.

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

**The browser tracks (`pnpm mock:web`) run anywhere.** Text-to-speech goes
through `voice/speech.ts`'s `SAY_ENGINE` switch — macOS `say`, or `piper`
elsewhere — and `voice/audio.ts` transcodes browser-captured audio with ffmpeg,
which carries no platform-specific flags on that path.

**The terminal tracks (`pnpm mock:voice`, `pnpm design:voice`) are macOS-only
today.** They record through ffmpeg's `avfoundation`, which does not exist
elsewhere, and `voice/devices.ts` enumerates devices through it. There is no
fallback and they will fail immediately on Linux.

Model backends, when you do want one, are per track and explicit — the `claude`
CLI, the Anthropic API, an OpenAI-compatible endpoint, or a local ollama model.
There is no default. See `AGENTS.md` under "Which model the interviewer runs
on".

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
