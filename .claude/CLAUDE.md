# Interview Prep

An interview practice repo. Standalone — it does not depend on any job-search
repo, but links to one when configured.

It is built for someone who can code but has not interviewed in years, where the
rust is pattern recall under pressure rather than ability. Everything follows
from that: bounded problem sets, budget-enforcing tests, and rationed hints.

This file is also the prompt several commands read, which is why it addresses the
candidate directly in places. Where it still says "he", that is leftover from
being one person's notes; nothing depends on it, and a sweep to second person is
outstanding.

## Tracks

| Track | Location | Command | Status |
|---|---|---|---|
| Coding | `problems/`, `solutions/` | `/drill` | live |
| System design | `system-design/` | `/design` | live |
| Behavioral | `behavioral/`, `local/stories.md` | `/mock` | live |
| Debugging | `debugging/` | `/debug`, `mock:web` `#/debug/<ex>` | live |
| Feature build | `feature/` | `/feature` | live |
| Company prep | `local/companies/` | `/prep` | live |
| Pairing | `problems/`, `solutions/` | `mock:web` `#/coach/<slug>` | live |

### Past drills

`#/history` on `mock:web` reads `local/drill-log.md` — the only structured record
any track keeps, so the screen says outright that it covers coding drills alone.

**Cold solves are reported separately from solves, everywhere on it.** The log's
own preamble demands that: "a solve that took four hints is a different fact from
a cold solve, and the log is useless if it flattens them." A single "7 of 9"
headline is that flattening, so the headline figure is the cold count.

**The pattern is withheld unless asked for**, and withheld *on the wire* rather
than hidden in the client — `GET /api/history` omits it without `?patterns=1`,
so it is not in the page until he opts in. A history screen is read between
drills and `/review` re-queues problems for spaced repetition; a permanent
problem-to-pattern list would spoil every re-drill at a glance. Turning it on is
a deliberate act, the same shape as `/coach`'s gate.

Two commands help rather than test, and both are gated on a drill being over:

| Command | What it does | Gate |
|---|---|---|
| `/review [problem]` | The debrief: the answer, the gap, the tell, what the suite was testing | Refuses without a finished attempt in `local/drill-log.md`. The **only** command permitted to read `solutions/**`. |
| `/coach [pattern]` | Teaches a pattern — tell, insight, cost, where it breaks | Reads `patterns.md`, so it **ends drilling for the session**. Requires an explicit yes first. |

The asymmetry is deliberate. Help during an attempt is rationed to one rung per
ask; help after one is complete and unrationed. What must never happen is the
second leaking into the first, which is why `/coach` burns the session rather
than trying to be careful.

### Keeping your attempts

`pnpm reset <problem>` archives `solution.ts` to
`local/attempts/<slug>-<YYYY-MM-DD-HHMM>.ts` before restoring the stub, so
re-drilling a problem no longer destroys the record of how you solved it last
time. Reading an old attempt beside a new one is the only way to see whether the
recall actually improved or you just got there again by the same slow route.

Three rules, each with a reason:

- **The filename carries the slug and never the pattern**, and the directory is
  flat rather than mirroring `problems/<pattern>/`. Same rule as coaching
  transcripts, same reason: the pattern is the answer, and this directory is meant
  to be browsed between drills, so a path naming it would spoil every re-drill at
  a glance.
- **An attempt identical to the stub is not archived.** That is not history, it is
  an empty file with a date on it.
- **A failed archive never stops the reset.** The reset is what was asked for, and
  refusing it because a copy could not be filed is the wrong trade.

Archiving and resetting are two exported functions rather than one with a flag,
and the write lives in the CLI. `resetProblem` is called by tests with a temp
root; had it archived by default, those tests would have written into the real
gitignored `local/attempts/`, which holds the only copy of anything there.

The stamp is **local** time, unlike `voice/transcript.ts`'s UTC one — this
directory is read by hand, so `voice/coached.ts`'s rule governs: a session at 9pm
files under the day it felt like. The UTC version stamped an attempt saved at
19:42 as `2342`, disagreeing with its own `coached.md` row.

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
pnpm drill [problem|pattern]  # a full coding drill with NO model involved:
                        # picks by rust, shows the prompt cold, asks for the brute
                        # force first, one hint rung per request, distinguishes the
                        # two reds, asks complexity before confirming, logs a row.
                        # Rungs 2 and 4 need no authoring (pattern name; solutions
                        # file); rungs 1 and 3 come from meta.yaml `hints.nudge`
                        # and `hints.approach`, and an unauthored rung says so
                        # rather than serving the next one up.
pnpm test <problem>     # run one drill
pnpm test               # everything, as a regression check
pnpm reset <problem>    # keep the attempt in local/attempts/, then restore stub.ts over
                        # solution.ts. See "Keeping your attempts".
pnpm domains            # domains the exercise set covers; `--for <company>` to tailor
pnpm exercises          # audits every authored exercise against its track's contract:
                        # files present, meta.yaml fields, a README that does not name
                        # its own pattern, a cost mechanism unless the tier is warmup,
                        # a stub that ships red, a worked answer to debrief from.
                        # **Reports on files without printing their contents** — it opens
                        # patterns.md and solutions/** to answer yes/no questions, so it
                        # is safe to run mid-session and safe for a model to run, which
                        # those files are not. Two severities: `broken` (cannot be
                        # drilled; exit 1) and `unauthored` (works, a part was never
                        # written; exit 0, because a script that fails over a to-do list
                        # gets ignored).
pnpm mock:voice         # spoken behavioral drill
pnpm mock:web           # React browser client (127.0.0.1) — builds, serves, opens Chrome.
                        # PORT=4199 to serve a second one alongside a running drill.
                        # Chrome by name, not the default browser: per the table below Arc
                        # never offers the microphone and fails silently, so handing the URL
                        # to whatever is default is a debugging trap. VOICE_NO_OPEN=1 skips it.
                        # Serves every spoken track — the four drills and the
                        # pairing session. The landing page chooses; each then gets
                        # its own screen at its own URL (#/mock, #/design/<p>,
                        # #/coding/<p>, #/debug/<ex>, #/coach/<p>), so a reload
                        # comes back to the same one instead of the chooser.
pnpm mock:web:vague     # ditto, but coding drills run clarify-first: the problem
                        # statement is withheld (on the wire, not in the client) and
                        # the interviewer opens with a deliberately underspecified
                        # spoken framing, answering only what he explicitly asks.
                        # A "Reveal the written statement" button gets it back at
                        # any point. Off by default and meant to stay a choice: a
                        # precise prompt is the right default for building recall of
                        # a pattern, and this practises the opening instead, which is
                        # a different exercise. VOICE_VAGUE=1 does the same thing for
                        # any of the mock:web variants. See CLARIFY_FIRST in
                        # voice/context.ts for the evidence behind it.
pnpm mock:web:claude    # ditto, every track on the Claude subscription
pnpm mock:web:ollama    # ditto, every track on the local ollama model
pnpm mock:web:hybrid    # ditto, behavioural local and the rest on Claude
                        # See "Which model the interviewer runs on" below.
pnpm build:web          # build the React client only (voice/web -> voice/dist)
pnpm dev:web            # Vite dev server with HMR for voice/web (proxies /api)
pnpm dev:web:api        # the node:http API/session server alone, for use alongside dev:web
pnpm design:voice <p>   # spoken live design drill
pnpm voice:devices      # list microphones and speakers for local/voice.json
pnpm voice:voices       # list the English `say` voices by tier, marking the configured one;
                        # `pnpm voice:voices "Ava (Premium)"` auditions one on a line the
                        # interviewer would actually say. See "How human the interviewer sounds".
pnpm typecheck          # covers voice/ and voice/web/ separately (different tsconfig)
```

### The spoken design track

`pnpm design:voice <problem>` is the terminal path; the browser path is the
design drill on `mock:web`'s Idle screen. Two things the browser adds, and they
are the reason the track waited for it: the **problem statement stays on screen**
for the whole drill (in a terminal it scrolls away, and a 45-minute design
interview where you cannot re-read the question tests the wrong thing), and the
header shows **time remaining** rather than time elapsed.

The interviewer has no clock of its own, so each turn it is fed a time check it
never sees spoken and that never enters the transcript — that is what makes
`design.md`'s "warn once at ten minutes, stop at time" followable at all. It
closes the interview and delivers the score itself; the countdown hitting zero
is a display, not a trigger, and nothing in the client ends the session on it.

Served from `system-design/<problem>/`: `README.md` only. `reference.md` is a
worked design and denied outright, and `rubric.md` — though not a denied file —
is deliberately never put on screen mid-drill, because it enumerates the
dimensions being scored.

### The spoken coding track

Browser only — there is no `coding:voice`. The drill needs the problem on screen
for 45 minutes and a **Run tests** button, and neither works in a terminal that
scrolls.

**There is no editor in the browser, deliberately.** He writes the answer in his
own editor, in the real `solution.ts`, against real types. The button runs that
problem's suite server-side and the interviewer is told the outcome as a
bracketed note it never speaks — `drill.md`'s step 7, reassigned, the same way
the design track's time check is.

The verdict distinguishes three reds and the distinction is the whole point:
correctness-red is a **wrong answer**; correctness-green-with-cost-red is a
**right answer that costs too much** — a working brute force, which is a
legitimate checkpoint — and `errored` is a suite that never ran. Collapsing the
first two into "failed" teaches the exact thing `drill.md` forbids.

A test run writes **no Andre entry** (he pressed a button; he said nothing), and
the bracketed verdict never enters the transcript. Transcripts land in
`local/drills/<problem>-live-<stamp>.md`.

**Hints are a button, and the rung is the server's.** "Ask for a hint" advances
exactly one rung of `rules/no-spoilers.md`'s ladder and the count shows on screen,
so the cost of asking is legible when he asks rather than discovered afterwards.
The server counts it and tells the interviewer which single rung is owed, quoting
that rung verbatim — a model asked for "a hint" over-delivers, and the count is
the number `/status` reads to tell rust from coverage, so it has to be a
measurement rather than a recollection.

**It writes a `local/drill-log.md` row**, the same table `/drill` appends to,
because `/status` reads exactly one log. The interviewer closes with a
```drill-log trailer supplying only judgement — solved, and the one-line note;
the date, problem, pattern, rung and elapsed time come from the server. Ending
the session drives one final interviewer turn to produce that closing, since
otherwise only drills that ran the full 45 minutes ever logged anything.

**The pattern is the answer, and a coding problem's path is its pattern.** So
`problems/<pattern>/<slug>` never leaves the server: routes take a bare slug,
`voice/problems.ts` is the only module that resolves one to a directory, the
resolved pattern is passed once into the prompt (the interviewer needs it to give
rung 2 of the hint ladder) and is deliberately *not* stored on the session, and
anything derived from test output goes through `stripPatternPaths` on the way
out. `voice/coding-routes.test.ts` asserts every one of those.

### The spoken debugging track

Browser only, like the coding track, and for the same reason: the bug report has
to stay on screen for forty-five minutes and there has to be a button that runs
the suites.

**The verdict is the exercise.** Where a coding drill has two kinds of red that
mean opposite things, this has two kinds of **green** — and the flattering one is
the wrong one. `repro` green with `invariant` red is a *symptom patch*, and
`debug.md` says to "say it plainly rather than congratulating a partial fix", so
`voice/debug-tests.ts` returns it as its own verdict kind rather than a count of
passing suites, and the bracketed cue states what it means. The classification
reads which **file** a failure came from, not suite names: the `describe` names
are the exercise author's, while `repro.test.ts` and `invariant.test.ts` are the
track's own.

**The interviewer has no answer to ration, and the ladder says so.** Its
allowlist is `debug.md` plus the bug report — not `src/**`, where the bug is
("you are running the exercise, not solving it"), and not
`solutions/debugging/<exercise>.md`, which `assertNoSpoilers` denies for every
track by the `^solutions/` rule. So of `debug.md`'s four rungs only the first can
be served, and past it the server tells the interviewer to say outright that it
cannot narrow further. That is deliberate: every later rung names part of the
defect, and a model asked for one without the answer invents a module — a
confident wrong pointer costs more than silence in an exercise about forming a
hypothesis. **A refusal is not recorded as help**, so the drill-log's hint count
stays a measurement of what was actually given, the same reason a pairing session
is not counted as an attempt.

**A bug report describes a system; `src/` is the whole of it.** Both confusions a
real drill hit were this: `account-switcher`'s report describes a dashboard and a
global nav, and nothing in `src/` calls the render functions at all; `entitlements-gate`'s
report describes Northwind Traders as a free-plan account with a billing record,
and `cust_48213` is deliberately not in the fixture — which is how "entitlements
cannot be resolved", the third test in each of its suites, is expressed. Both read
as a half-written exercise. The report is *meant* to be written by someone
describing a system they cannot see, so the problem pane now says the fixtures are
the whole world and an absent id is a state rather than a missing file, and
`pnpm exercises` prints every id a bug report names that its `src/` does not
contain — for judgement, not as a finding, since it is usually the point.

**Two things it must answer, and one it must never volunteer**, both learned from
a real drill on 2026-08-10. The interviewer spent two turns pushing a specific
causal theory — async work in flight from before the switch — having been shown
the bug report and nothing else; a guess phrased as a question reads as informed
and costs ten minutes, so the prompt now forbids naming any mechanism. And it
refused "where is the render call?" as though the answer were part of the puzzle,
when in fact **no exercise here has a running application**: nothing in `src/`
calls the render functions, and `repro.test.ts` and `invariant.test.ts` are the
only entry points. That is the harness's shape rather than anything's answer, so
the prompt says to state it and the problem pane says it on screen.

**It writes the same drill-log table**, with `Pattern` set to `debugging` per
`debug.md`, because `/status` and `#/history` read exactly one log. Transcripts
land in `local/debugging/`. The history screen therefore no longer claims to cover
coding drills alone — it covers the two tracks that write a scored row, and on a
debugging row `solved` means the root cause rather than a symptom patch.

### The pairing track

The one mode that is not a test. `#/coach/<slug>` on `mock:web`, reached from the
landing page's **Pairing** card — landing page only, because a link to it from a
drill screen is exactly the leak the hint ladder exists to prevent. Starting one
has to be a decision made before you begin, not an escape hatch reachable while
you are stuck.

**It is a separate door, not the drill door with the lock off.** The coach reads
the worked solution and `patterns.md`; `assertNoSpoilers` still refuses both, and
`allowedPaths('coach', …)` **throws** rather than returning a wider allowlist.
`voice/coach.ts` builds the prompt from `coachPaths` on its own, and
`voice/coach.test.ts` asserts both halves: the guard still rejects every path a
coach reads, and the drill door still refuses to open for the track. A track
exemption inside the guard would have turned one absolute rule into a conditional
one — which is the rule not existing.

Untimed, unrationed, unscored. No clock is sent, so no turn carries a time check;
the hint button and the rung count are **omitted from the screen, not disabled**,
because a greyed-out "Ask for a hint" advertises a cost that does not exist.
**Run tests** stays, and so does writing code in your own editor: the coach is fed
`solution.ts` as it stands each turn, as a bracketed cue it never speaks and never
mistakes for something you said — the same mechanism as the design track's time
check and the coding track's verdict.

**A session writes `local/coached.md`, never a drill-log row.** `summarise()`
counts attempts and cold solves and the history screen leads with the cold count;
nobody was tested in a pairing session, so counting one as an attempt would
corrupt the only number that screen asks you to trust. `GET /api/history` reports
the paired problems (unconditionally — pairing is something you chose and sat
through, so saying it happened spoils nothing) and the table marks them, because
a cold solve of a problem you were walked through is weaker evidence of recall
than one you were not. It is a marker, not a deduction: only you can weigh it.

The track has its own `VOICE_BACKEND_COACH`, and that is deliberate — it teaches
rather than asks, so a confident wrong explanation is its failure mode and no
suite contradicts it.

### Two things a spoken session records about itself

**The interviewer speaks to you in the second person, and the prompt says so.**
It did not, until a drill on 2026-08-10 was conducted in the third person and
spoken aloud that way — "He said the text reads the same forwards and backwards
... Where do those fit into what he just told me?" — with the closing verdict
delivered as a report filed about him rather than something said to him.
Everything else in the prompt refers to the candidate as "he" because it is
written *about* the drill, so the one line naming the voice to answer in has to
be explicit. It was being inferred, which worked until the model changed.

**A transcript names the backend and model that produced it** (`Interviewer: cli
/ claude-sonnet-5`, under the heading). The startup banner says what the *server*
is on; a transcript read days later has to say what *that session* was on. Without
it, diagnosing the drill above meant comparing the file's timestamp against the
commit that changed the default model — corroborating evidence from git for a
question the artifact should answer itself.

**Ending a session is latched, and `POST /end` is not re-entrant.** Two client
paths fire it — the dock's End session button and `beforeunload`'s `sendBeacon` —
and on the coding track it awaits a closing interviewer turn, so it is in flight
for a model minute while the session sits in the store looking live. `store.get`
is not a guard against a second caller: the same drill wrote **two transcripts**
(the earlier one truncated mid-drill) and logged **`00:00`** for a session its own
transcript stamped at `03:05`, because the finisher holding the verdict read an
entry clock its racing partner had already deleted. The second caller now gets a
409, the elapsed time is sampled *before* the closing turn so the model's own
minute is not billed to you, and both client paths hold a latch of their own.

### Browser support for `mock:web`

**Use Chrome.** The web drill needs `getUserMedia`, and browsers disagree about
whether a plain-HTTP loopback origin is a secure context:

| Browser | Plain HTTP on 127.0.0.1 | Notes |
|---|---|---|
| Chrome, Firefox | works | loopback is exempt |
| Safari | needs HTTPS | no loopback exemption |
| Arc | does not work | needs HTTPS, and still failed with a trusted cert — not worth chasing |

The failure mode is nasty rather than obvious: `navigator.mediaDevices` is
simply absent, or `getUserMedia` never settles — no prompt, no rejection, no
console error. The page's **Mic check** button (top right) reports which of
those is happening.

For HTTPS, drop a mkcert pair in the gitignored `local/certs/` and the server
picks it up automatically:

```bash
mkdir -p local/certs && cd local/certs
mkcert -cert-file cert.pem -key-file key.pem localhost 127.0.0.1 ::1
mkcert -install   # needs your password; run in a real terminal, not via `!`
```

Open `https://127.0.0.1:4173/`, **not** `localhost` — the server binds IPv4
only and browsers try `::1` first.

`VOICE_DEBUG=1` logs every request's method, path and status (never bodies —
a turn body is recorded audio).

### Transcription vocabulary

whisper runs `ggml-large-v3-turbo` — the ceiling for local — so the model is not
a lever. `--prompt` is, and `voice/vocabulary.ts` supplies it per track.

The reason is measured, not assumed: a real drill transcript recorded "O of n"
as "on" twice and "N" as "M", and the interviewer then marked him down for
"reciting a shape" on the basis of an M he may never have said. A drill that
scores a transcription bug is measuring the wrong thing.

**The coding vocabulary names no data structures.** whisper hallucinates prompt
content into output on short or silent audio, and a pattern is the answer — so a
term list holding "monotonic stack" could plant it in his own transcript.
`vocabulary.test.ts` enforces this against the real `problems/` directory names,
so authoring a new pattern can break the test rather than silently making a term
unsafe. The design track has no such constraint (its spoiler is `reference.md`)
and gets its domain terms.

This is **not** an LLM cleanup pass, deliberately. `speech.ts` keeps filler and
false starts because `/mock` grades them, and a cleaner that smoothed a wrong
answer would have the interviewer reply to a better answer than he gave.

### How human the interviewer sounds

TTS is macOS `say`, on the server rather than in the browser — which is what makes
`Speaker.stop()` necessary at all, since a page that closes has no effect on a
running subprocess.

**The voice is the dominant term, and it is not a code setting.** macOS ships only
the pre-neural legacy voices; Samantha dates from 2009 and no configuration makes
her sound like a person. The Enhanced and Premium builds are a separate download —
System Settings > Accessibility > Spoken Content > System Voice > Manage Voices —
and until one is installed, `pnpm voice:voices` says so outright rather than
printing a list that looks like a working set of choices.

`local/voice.json` carries `voice` and `rate` alongside the devices, resolved by
`resolveSpeech` as **env (`SAY_VOICE`, `SAY_RATE`), then the file, then the
voice's own default**. One function rather than a `??` chain in each front end, so
`SAY_VOICE` cannot come to mean one thing in a terminal drill and another in a
browser one. A rate that is not a usable number is dropped rather than passed to
`say -r`, which would fail the whole utterance: a bad rate costs the rate, not the
drill.

Set the rate a little low. An interviewer talking at screen-reader pace reads as a
machine however good the voice is, and the pauses are where you get to think.

**`configuredSpeaker` re-reads the file per sentence** so a change takes effect on
the next sentence rather than the next restart — and it holds the utterance in
flight, because it has to implement `stop()`. It once did not: it was a bare
closure over `speak`, so `deps.speaker?.stop?.()` in the SSE close handler
silently did nothing and refreshing the page left the interviewer reading its
reply to an empty room. Only the terminal path, which uses `saySpeaker` directly,
ever had a working one. The fix that bug was reported for was real; it just never
reached the front end that had the bug.

### Which model the interviewer runs on

Three backends, chosen **per track** and never by sniffing the environment.
`voice/backend.ts` owns the choice; `describeBackend` prints it, with what it
spends, at startup and at session creation.

| Backend | What it is | Spends |
|---|---|---|
| `cli` (default) | `claude -p` against the logged-in subscription | subscription quota |
| `api` | the Messages API | Console credits |
| `ollama` | a local model over HTTP | nothing |

Three serving commands, so the choice is made by which one you type rather than
by remembering what is exported:

```bash
pnpm mock:web:claude    # every track on the subscription
pnpm mock:web:ollama    # every track local
pnpm mock:web:hybrid    # behavioural local, design and coding on Claude
pnpm mock:web           # whatever the environment says; the default is claude
```

**Each of the three sets every variable, including the ones it does not want.**
`VOICE_BACKEND_MOCK=` with an empty value reads as unset, so
`pnpm mock:web:claude` genuinely means all-Claude even with a stale
`VOICE_BACKEND_MOCK=ollama` exported in a shell profile. A command whose
behaviour depends on what is already in the environment is not a choice.

The variables underneath, for a one-off:

```bash
VOICE_BACKEND=ollama            # every track
VOICE_BACKEND_MOCK=ollama       # one track; beats the global. Also
                                # _DESIGN, _CODING, _COACH and _DEBUG.
VOICE_CLAUDE_MODEL=claude-opus-5 # override the Claude model for a drill worth it
OLLAMA_MODEL=gpt-oss:20b        # override the local model (tags are case-sensitive)
OLLAMA_HOST=10.0.0.5:11434 # a bare host:port is accepted, as ollama's CLI does
```

An unrecognised value **throws at startup** rather than falling back — a typo
silently running a 45-minute drill on the expensive path is the failure this
arrangement exists to prevent. The old behaviour (any `ANTHROPIC_API_KEY` in the
environment quietly outranking the subscription) was exactly that failure.

**`OLLAMA_HOST` cannot yet point at the homelab gateway, because this client
sends no credentials.** `ollama-gateway` (`~/projects/ollama-gateway`, built
2026-08-11) fronts LXC 113 (the P40) and the in-cluster CPU deployment behind one
address, routing each request to whichever box holds the requested model — which
is what `OLLAMA_HOST` would otherwise have to be re-pointed by hand to do. But
the gateway requires a bearer token on every route except `/healthz`, and both
`fetch` call sites here (`preloadOllama` and `ollamaStream` in `voice/ollama.ts`)
send only `content-type`. Pointing `OLLAMA_HOST` at it today returns **401 on
every drill turn**, and `preloadOllama` reports rather than throws, so the first
sign would be the drill itself failing.

The fix, when it is wanted: read an `OLLAMA_API_KEY` and set
`Authorization: Bearer` at both call sites when it is present. Absent must keep
meaning unauthenticated, so pointing `OLLAMA_HOST` straight at a box goes on
working unchanged — the gateway is an addition, not a migration, and a drill
should not start depending on a service that can be down.

**The Claude default is Sonnet, not Opus, and the reason is cost.** `Interviewer`
owns the history and re-sends the whole transcript every turn, so a drill's spend
grows quadratically in turns; on a $20 subscription that ends the practice before
the practice is done. Sonnet still follows the rules these prompts carry, which
is the property that matters.

**The knob is per track because the tracks are not equally forgiving.** `mock` is
behavioural: no spoiler to leak, no hint ladder, no fenced trailer to emit. It is
the safe place for a weaker model. `coding` is the opposite on all three counts.
A single global knob would be a choice about the worst track, so the recommended
arrangement is the hybrid — `VOICE_BACKEND_MOCK=ollama`, Claude elsewhere.

**A local model reads its own thinking aloud unless stopped.** Measured against
a 30B local model on ollama 0.24.0, with `think: false` set and ignored: 307 of 314
tokens were deliberation, emitted as ordinary `message.content` and terminated by
a bare `</think>` with no opening tag. `SentenceBuffer` speaks content, so
unfiltered that goes out of the speaker — and on the coding track the
deliberation states what the model thinks the answer is. `createThinkGate` in
`voice/ollama.ts` is the fix, and holding output back until the marker arrives
costs the streaming: roughly six seconds of silence before a reply starts. The
client's `thinking` phase displays it, so it is a wait rather than a mystery.

**The local model is picked by drilling it, not by size, and 2026-08-10 retested
that from scratch. `Qwen3.5:9b` survived.** Single-turn throughput on the P40 box
(LXC 113) says the opposite and is the trap: **gpt-oss:20b 44.8 gen tok/s / 404
prompt**, `qwen3:30b-a3b` 52.2 / 277, `Qwen3.5:9b` 30.2 / 315, `qwen3:14b`
22.3 / 269, `granite4.1:30b` 12.0 / 118. On that table the 9B looks third-best.

**The multi-turn test reverses it.** Four-turn behavioural mocks through the real
`context.ts` rules — three gpt-oss runs, two Qwen:

| | `Qwen3.5:9b` | `gpt-oss:20b` |
|---|---|---|
| Tokens per 4-turn mock | **121-126** | 437-596 |
| Wall clock per turn | **~1.0s** | ~2.8s |
| Leaked deliberation into `content` | never | **1 turn in 12** |
| HTTP 500 mid-session | never | once, unexplained |

**The tok/s win is a mirage: 1.5x faster per token, 4x the tokens, so ~2.6x
slower per turn** — and the turn is what he waits through. Reasoning tokens bill
to the same budget as the answer.

**Nor is the channel separation reliable**, which was the only other reason to
switch. gpt-oss is clean most of the time, then emits *"The user said hardest
part was getting SRE aligned... Need to ask one question. I'll ask:"* as ordinary
content. `createThinkGate` stays load-bearing; its ~6s is not recovered.

**On question quality the 9B is better, not merely cheaper.** It engages with
what was said — *"what was the specific mechanism you used to detect and
automatically roll back when an error rate spiked during the canary window?"* —
where gpt-oss reaches for generic *"what were the biggest challenges you faced
during that migration?"* more often than not.

`qwen3:30b-a3b` fails differently: `think: false` dumps 1,858 characters of
"Okay, the user wants me to..." into `content` (`/no_think` does not help), and
`think: true` burns all 400 tokens deliberating and returns an **empty**
`content`. That is a mechanism for the old 76.8s "delivered a critique instead".

**Standing lesson: throughput is the wrong metric.** Tokens-per-turn times
seconds-per-token is the one he experiences, and a reasoning model loses on it
while winning the benchmark. Note the capital Q — ollama tags are case-sensitive
and `qwen3.5:9b` is a 404.

**Climbing the dense Qwen ladder buys nothing on this hardware.** `qwen3:14b` is
*slower* than the 9B (22.3 vs 30.2 tok/s) for no gain on the task. Generation is
memory-bandwidth-bound, so on a fixed card more dense parameters is strictly
slower.

**Open prompt bug, not a model problem:** both models compound two questions with
"and", which the voice-mode rules explicitly forbid, and a naive `?`-counter does
not catch it.

Two more measured facts drive that file's defaults: **cold model load was ~168s**
(hence `preloadOllama` at startup and `keep_alive: '30m'`), and ollama's default
`num_ctx` of **4096 truncates silently** — on a 45-minute drill that is an
interviewer that has quietly forgotten the problem statement, the time check and
the hint count, with no error anywhere. `num_ctx` is therefore always sent
explicitly.

## Tests encode the insight

A drill is only worth doing if a **correct but brute-force** solution fails it.
Two mechanisms do that, and picking the right one depends on whether the
problem hands the solver an expensive operation:

- **Oracle budget** — the problem exposes an expensive operation (like
  `knows()` in the celebrity problem). Wrap it with `countCalls` from
  `test-utils/oracle.ts` and assert a budget with `assertWithinBudget`.
  Randomise the fixture geometry with `seededTrials` from
  `test-utils/random.ts` so no fixed probe order can exploit a lucky pattern
  in a hand-picked fixture — see the comments in
  `problems/elimination/celebrity/solution.test.ts` for why this matters and
  how it's built.
- **Scale test** — no oracle exists, so use an input large enough that the
  brute force takes tens of seconds while the reference finishes in well under
  a second. Require at least two orders of magnitude of margin between the two.
  Generate the input deterministically with `mulberry32`/`seededTrials` from
  `test-utils/random.ts` rather than `Math.random()`, so the suite stays
  reproducible.

  **The `testTimeout` does not enforce this — the elapsed-time assertion does.**
  Vitest cannot preempt synchronous JavaScript, so a brute force that blocks the
  event loop runs to completion and *then* reports; a measured case here ran 48s
  inside a 10s timeout and still returned a result. Every scale test therefore
  asserts `elapsed` explicitly, and the 10s timeout only catches the async ones.

  **Size the fixture by measuring, never by eye.** `max-sum-window` was authored
  at n = 200,000 with k = 50,000, and the from-scratch solution *passed* it in
  four seconds; the cost is `(n - k + 1) * k`, maximised at `k = n/2`, which is
  where it sits now. This is exactly what the three-way proof below is for.

When authoring a new problem, prove the suite three ways before committing: it
must fail a wrong solution, fail a brute-force solution, and pass the reference.
A suite a brute-force answer passes is broken, whatever the reference does.

### Declaring a pattern that is also the question

`pnpm exercises` refuses a README that contains its own pattern name, because the
prompt naming the pattern is the answer. One case is legitimate: `reverse-list`
lives under `linked-list`, and "reverse a linked list" cannot be asked without
saying it — what that drill tests is the pointer dance, not recognising the
structure. No checker can tell that from a leak, so the exercise declares it with
`pattern-in-prompt: accepted` in its `meta.yaml` and the check honours the
declaration. An undeclared match stays broken, which keeps the default strict and
puts the exemption next to the exercise that needs it rather than in a list inside
the checker.

### The warm-up tier

`meta.yaml` carries `difficulty:` — `warmup`, `easy`, `medium` or `hard` — and
**`warmup` is a deliberate exemption from the rule above.** Those suites check
correctness only.

The exemption exists because the rule, applied strictly, excludes every classic
opener: reverse a linked list, valid anagram, max depth of a tree, valid
palindrome. None of them has an asymptotically-worse-but-correct approach to
reject, so none can carry a cost gap — and after five years away, those are
exactly the reps that need doing. Interviews open with them too, so drilling
them is drilling the real thing.

Keep the exemption visible rather than quiet. A warm-up's test file opens with a
comment saying it is correctness-only and why, its README says there is no
hidden cost trap, and its `meta.yaml` `budget:` line points back here. A drill
that silently lacks teeth is indistinguishable from a broken suite; one that says
so is a different exercise.

Every other tier is bound by the rule. `easy` means *easy insight with a real
cost gap*, not *no insight* — `two-sum-sorted`, `contains-duplicate`,
`valid-parentheses`, `climbing-stairs`, `max-sum-window` and
`range-sum-queries` all reject a brute force.

The other tracks use the same idea with a different discriminator:

- **Debugging** — `repro.test.ts` reproduces the reported symptom and a symptom
  patch turns it green; `invariant.test.ts` covers a second path with the same
  defect and only a root-cause fix turns it green. Prove it by applying the most
  tempting local patch and confirming `invariant` stays red.
- **Feature** — `regression.test.ts` ships green and guards existing behaviour;
  `feature.test.ts` ships red and defines done. Prove the regression suite has
  teeth by making a careless change and confirming it is caught.

Note what "ships red" means per track: coding and feature stubs throw
`not implemented`; debugging exercises fail on assertions, because the bug is
real code doing the wrong thing.

## Tailoring to a company

`debugging/`, `feature/` and `system-design/` exercises carry a `domains:` list
in `meta.yaml` — neutral capability tags, deliberately **not** company names.
`local/companies/<company>.md` declares that company's domains in a one-line
HTML comment, and `pnpm domains --for <company>` intersects the two, ranking an
exercise higher when it covers more of them.

The indirection is the point, for two reasons:

- Everything outside `local/` must be publishable un-redacted, so nothing
  committed may name an employer. The naming lives in the gitignored research.
- The research does not support naming questions. `/prep` caught and excluded
  two fabrications researching one company, and the reports it trusted name a
  single coding question. A domain is a claim about the *exercise*, checkable by
  reading it; "company X asks this problem" is not, so the schema cannot say it.

So this **selects from the authored set and never generates**. An empty result
is a real answer — inventing an exercise to fill the gap is the failure mode the
whole arrangement exists to prevent. `problems/` is excluded: its exercises are
pattern drills, its `meta.yaml` carries `pattern:`, and that is a spoiler.

## job-search link

`local/config.yaml` may set `job_search_path`. When present, commands may read
(never write):

- `user/master-resume.md` — the record `/prep` writes gap notes against
- `user/communication-style.md` — critique rubric for behavioral answers
- `user/research/<company>.md` — existing org research

When absent or wrong, skip the step with a one-line note. Never error, and never
guess the path.

## Tone

Three standing rules for any drafted answer: first-person and conversational
rather than third-person corporate; never compliment a company by implying your
current employer is worse; answer the question asked instead of pitching a
project.

Override them in `local/` if your instincts differ — they are one person's
preferences that happened to be worth writing down, not findings.
