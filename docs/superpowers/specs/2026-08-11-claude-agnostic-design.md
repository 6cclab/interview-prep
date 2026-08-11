# Making interview-prep provider- and platform-agnostic

**Date:** 2026-08-11
**Status:** approved design, not yet implemented

## Why

The repo is to be shared with a coworker. Today three separate things assume
Claude specifically, and a fourth assumes macOS:

1. **Transport.** `voice/backend.ts` offers `cli | api | ollama`. Two of the
   three are Anthropic, the default is Anthropic, and there is no path in for
   someone holding an OpenAI, Azure or vLLM endpoint.
2. **The agentic layer.** The nine `.claude/commands/*.md` files are Claude Code
   slash commands. A coworker on Codex or Cursor gets none of them.
3. **Documentation.** `.claude/CLAUDE.md` is the design document for the whole
   repo, cited by name in 37 lines across `problems/**/meta.yaml`, `scripts/`,
   `voice/` and `README.md`.
4. **Speech.** TTS is macOS `say` (`voice/speech.ts:151`). On any other platform
   the browser tracks do not run at all.

A fifth thing is *personal* rather than Claude-shaped: the prompts and docs
address the candidate by name, and the prompts are model input — so an
un-parameterised name means the interviewer greets the coworker as Andre.

Explicitly **not** in this spec: deploying to the homelab, and the browser IDE.
Both are noted under Follow-ups.

## The constraint everything must preserve

`voice/backend.ts:24` states the rule this repo already lives by:

> Nothing here sniffs for a running ollama or an available key and switches
> silently. [...] a transport you did not choose is a transport you discover
> mid-drill.

Every addition below is explicit selection that fails loudly, never inference.
The same applies to the new Speaker: platform is a *default*, an env var is an
*override*, and a missing binary is a startup error rather than a mid-drill one.

## 1. An OpenAI-compatible backend

New module `voice/openai.ts`, shaped like `voice/ollama.ts` so the two read
alike — pure functions tested separately from the I/O:

- `openaiStream(opts): StreamFn` — the only impure export
- `openaiChatBody(system, history, opts)`
- `extractOpenaiDelta(parsed): string | null`
- `extractOpenaiError(parsed): string | null`
- `normaliseBaseUrl(raw): string`

It gets its own parser rather than reusing ollama's: `/v1/chat/completions`
with `stream: true` emits SSE (`data: {…}` lines terminated by a `[DONE]`
sentinel), where ollama emits NDJSON. Nothing is shared there.

**`createThinkGate` moves to `voice/think-gate.ts`** and both adapters import
it. It is currently in `voice/ollama.ts:268`, and the failure it exists for is
not ollama-specific: a reasoning model served by vLLM or LM Studio over an
OpenAI-compatible endpoint leaks deliberation into `content` the same way, and
on the coding track that deliberation states what the model thinks the answer
is. Mechanical move; its tests move with it.

### Configuration

| Variable | Meaning | Default |
|---|---|---|
| `OPENAI_BASE_URL` | any OpenAI-compatible endpoint | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | model id | `gpt-4.1` |
| `OPENAI_API_KEY` | credential | none — **absent throws at startup** |

The base URL default is the only place a specific vendor is named, and it is
overridable, so Azure / Groq / together / vLLM / LM Studio all work unchanged.

### Changes to `voice/backend.ts`

- `'openai'` added to `Backend` and `BACKENDS`
- `describeBackend` gains a case naming what it spends
- `transportLabel`'s model resolution gains the `openai` branch, so a transcript
  header records the model that actually produced it

## 2. No default backend

`DEFAULT_BACKEND` is removed. `chooseBackend` throws when neither the track
variable nor the global one is set, with a message naming the four backends and
the four scripts.

Rationale: with a per-provider script for every case, the unset case is not a
convenience, it is the one remaining Claude-shaped default in the repo.

### Scripts

Add `mock:web:openai`. Existing scripts keep their names.

**Fix a live bug while here.** The design doc (`.claude/CLAUDE.md` today,
`AGENTS.md` after this work) states the invariant — *"Each of the three sets
every variable, including the ones it does not want"* — because an
empty value reads as unset and a stale export must not leak in. But the scripts
in `package.json` blank only `VOICE_BACKEND_MOCK`, `_DESIGN` and `_CODING`.
`VOICE_BACKEND_COACH` and `VOICE_BACKEND_DEBUG` were added later and no script
was updated, so today a `VOICE_BACKEND_COACH=ollama` in a shell profile survives
`pnpm mock:web:claude`.

The invariant existed only in prose, which is why it drifted. It becomes a test:
read `package.json`, assert every `mock:web:*` script sets each of the five
track variables, derived from `TRACK_VAR` rather than a second hand-written list.

## 3. A non-macOS Speaker

`saySpeaker` is untouched. Add `piperSpeaker` alongside it, satisfying the same
`Speaker` interface (`speak`, and the `stop` that `voice/speech.ts:22` explains
is load-bearing — TTS runs on the server, so a page that closes cannot silence
it).

**Implementation:** `piper` synthesising to stdout, piped to
`ffplay -nodisp -autoexit -`. ffmpeg is already a hard dependency of the browser
tracks (`voice/transcode.ts`), so this adds one binary rather than two, and the
quality is far above espeak-ng. `stop()` kills both ends of the pipe.

**Selection:** `resolveSpeaker(env, platform)` — explicit `SAY_ENGINE`
(`say` | `piper`) wins; otherwise `darwin` → say, anything else → piper. A
missing binary for the chosen engine is a startup error naming the install
command.

**Config:** `local/voice.json`'s `voice` and `rate` are `say`-shaped. Rather
than growing the schema, `resolveSpeech` (`voice/devices.ts:198`) keeps
returning the same two fields and each engine interprets them — `voice` is a
`say` voice name or a piper model path; `rate` is `say -r` or piper's
`--length-scale`. The existing rule that an unusable rate is dropped rather
than passed through (a bad rate costs the rate, not the drill) applies to both.

**Not in scope:** `voice/audio.ts` and `voice/devices.ts` use ffmpeg's
`avfoundation`, which is macOS-only. These are the *terminal* tracks
(`mock:voice`, `design:voice`) only — the browser tracks upload a MediaRecorder
blob through `transcodeToWav`, which passes no `-f` and is portable. So the
browser tracks become cross-platform and the terminal ones do not. README says
so plainly.

## 4. Relocating prompts and docs

The four track prompts are **runtime inputs**, not just slash commands:
`allowedPaths` (`voice/context.ts:57`) reads `drill.md`, `debug.md`,
`design.md` and `mock.md` into the interviewer's system prompt. So this is a
code change, not a file move.

### New layout

```
prompts/drill.md              real content; the server reads these
prompts/debug.md
prompts/design.md
prompts/mock.md
prompts/rules/no-spoilers.md
AGENTS.md                     the design document, at the root

.claude/CLAUDE.md             one line: @AGENTS.md
.claude/commands/*.md         stubs: read the matching prompts/ file
```

The five commands with no server counterpart (`coach`, `feature`, `prep`,
`review`, `status`) move to `prompts/` too, so the directory is the whole set
rather than the subset the server happens to read.

Stubs rather than symlinks: symlink support varies by platform and tool, and
this repo is now meant to be cloned by someone else.

### Consequences

- `allowedPaths` points at `prompts/*`. `coachPaths` (`voice/coach.ts:38`) reads
  no command file at all — it reads the problem, its suite, its worked solution
  and `patterns.md` — so it is untouched by the move
- Seeded fixtures in `voice/spoiler-gate.test.ts:23`, `voice/context.test.ts`
  and `voice/debug-routes.test.ts` follow
- 37 citations updated across `problems/**/meta.yaml`, `scripts/`, `voice/`
  comments, `README.md`, `voice/web/src/App.tsx`
- **`assertNoSpoilers` is unchanged.** Its `DENIED` list (`^solutions/`,
  `^patterns\.md$`, `reference\.md`) does not collide with `prompts/`, so the
  spoiler gate's behaviour is identical before and after. This is deliberate:
  the guard is the last line of defence and this work has no reason to touch it.

## 5. The candidate's name

`local/config.yaml` gains `candidate_name`. It is seeded by `pnpm bootstrap`
from `templates/local/config.yaml` with the neutral default `the candidate`,
and `scripts/bootstrap.ts` accepts `--name "…"` to set it in one step. Bootstrap
stays non-interactive: it is safe to pipe and safe to re-run, and
`seedLocal` already never overwrites.

**Substitution happens at prompt-build time, not on disk.** Committed files
carry a `{{candidate}}` token; `buildSystemPrompt` and `voice/coach.ts`
interpolate it when assembling the system prompt. Rewriting the files at
bootstrap would put a coworker's name into `git status` as a diff against every
prompt.

No YAML dependency is added. The repo already hand-rolls single-key reads for
exactly this (`voice/exercises.ts:36`, `scripts/domains.ts:56`,
`voice/problems.ts:54`) and the new reader follows that pattern.

A prompt reaching the model with an un-substituted `{{candidate}}` is a bug, so
a test asserts no token survives `buildSystemPrompt` for any track.

Separately and independently: the docs and prompts narrate the candidate in the
third person. `AGENTS.md` already records that a sweep to second person is
outstanding, and the prompts already have to carry an explicit instruction to
speak in the second person because it was otherwise being inferred. With the
name parameterised, that sweep is a small prose edit and is included here.

## Testing

New:

- `voice/openai.test.ts` — chat body shape, SSE delta extraction, error
  extraction, base URL normalisation, `[DONE]` handling
- `voice/think-gate.test.ts` — the moved tests, unchanged
- `voice/speech.test.ts` additions — piper argv, `resolveSpeaker` across the
  platform/env matrix, `stop()` killing the pipe
- a `package.json` script test — every `mock:web:*` sets all five track vars
- a `{{candidate}}` substitution test across every track

Changed: the three test files seeding `.claude/commands/*` fixtures.

Gate before calling it done: `pnpm typecheck`, `pnpm test`, `pnpm exercises`.
`pnpm exercises` matters specifically because it reads `meta.yaml` files whose
`budget:` lines cite the doc path being moved.

## Risks

- **The relocation is wide and shallow.** 37 citations plus three fixture files.
  The risk is a missed reference, not a design flaw; `pnpm test` and
  `pnpm exercises` catch the ones that matter, and a repo-wide grep for
  `.claude/` is the final check.
- **piper is unverified on this hardware.** Neither the binary nor the
  piper→ffplay pipe has been run here. If piper proves awkward, espeak-ng is the
  fallback at materially worse quality; the `Speaker` interface makes that swap
  contained.
- **No OpenAI-compatible endpoint has been tested against.** The SSE shape is
  well-known but the adapter is written from the spec, not from a captured
  response. First run against a real endpoint is where this gets confirmed.

## Follow-ups, not in this spec

- **Browser IDE.** Its own brainstorm. It reverses a documented decision
  (*"There is no editor in the browser, deliberately"*), and two things now
  undercut that decision's reasoning: a homelab deploy breaks the
  shared-filesystem assumption, and a coworker must wire up their own editor
  before the first drill runs. Needs its own spec covering editor choice,
  where `solution.ts` persists, whether types resolve in-browser, and what
  happens to `pnpm reset`'s attempt archive.
- **Homelab deploy.** The `127.0.0.1` bind (`voice/http-server.ts:1622`, which
  is deliberate — a live drill's context includes a private story bank), TLS for
  `getUserMedia` over LAN (the machinery exists via `readTlsMaterial`; it needs
  a cert), and the editor/test-runner filesystem question the IDE may resolve.
