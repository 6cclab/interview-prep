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
| System design | `system-design/` | `/design` | live |
| Behavioral | `behavioral/`, `local/stories.md` | `/mock` | live |
| Debugging | `debugging/` | `/debug` | live |
| Feature build | `feature/` | `/feature` | live |
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
pnpm mock:voice         # spoken behavioral drill
pnpm mock:web           # React browser client (127.0.0.1) — builds, then serves.
                        # Serves BOTH spoken tracks: behavioral is the primary
                        # action, and the Idle screen also offers a timed system
                        # design drill with the prompt kept on screen.
pnpm build:web          # build the React client only (voice/web -> voice/dist)
pnpm dev:web            # Vite dev server with HMR for voice/web (proxies /api)
pnpm dev:web:api        # the node:http API/session server alone, for use alongside dev:web
pnpm design:voice <p>   # spoken live design drill
pnpm voice:devices      # list microphones and speakers for local/voice.json
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

Open `https://127.0.0.1:4174/`, **not** `localhost` — the server binds IPv4
only and browsers try `::1` first.

`VOICE_DEBUG=1` logs every request's method, path and status (never bodies —
a turn body is recorded audio).

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
  brute force cannot finish inside Vitest's 10s timeout while the reference
  finishes in well under a second. Require at least two orders of magnitude
  of margin between the two. Generate the input deterministically with
  `mulberry32`/`seededTrials` from `test-utils/random.ts` rather than
  `Math.random()`, so the suite stays reproducible.

When authoring a new problem, prove the suite three ways before committing: it
must fail a wrong solution, fail a brute-force solution, and pass the reference.
A suite a brute-force answer passes is broken, whatever the reference does.

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
