# Voice Drills — Design

**Date:** 2026-08-07
**Status:** Approved, ready for planning

## Problem

Two tracks in this kit practice a skill that is delivered out loud and graded on
delivery, but are currently exercised by typing.

`/mock behavioral` grades an answer on structure, specificity, tone, and length —
"two minutes is the target, if the answer would run past four, say where to cut."
None of that is observable in a typed answer. Typing removes the filler, the false
starts, and the pacing, which are the things that actually go wrong in a room. It
also removes the clock: a typed answer has no length in minutes.

`/design --live` is already a 45-minute timed conversation that gets scored from a
transcript, and every rubric dimension it grades — scoping, estimation, failure
modes, technology choice — is verbal. Typing it is the least faithful part of an
otherwise faithful exercise.

The rust this kit exists to fix is recall under pressure, delivered to a stranger
on a clock. Two of the five tracks currently practice everything about that except
the delivery.

## Non-goals

- **Voice for `/drill`, `/debug`, or `/feature`.** Those need an editor and a test
  runner. Narrating code aloud is not the skill being rebuilt.
- **A whiteboard for `/design`.** Real design interviews involve drawing, but
  `rubric.md` does not grade the diagram — it grades scoping, numbers, and failure
  modes, all of which are spoken. Adding a canvas is scope that buys no score.
- **Barge-in / real-time duplex.** An interviewer who cuts you off is higher
  fidelity and materially more work, and interruption handling is not the failure
  mode being trained. Deferred, not rejected.
- **Replacing the typed commands.** `/mock` and `/design` stay exactly as they are.
  Voice is a second entry point to the same prompts, not a migration.

## Architecture

### Plain Messages API, no file tools

The interviewer runs on the Anthropic TypeScript SDK (`@anthropic-ai/sdk`) against
`client.messages.stream`. It is **not** built on the Claude Agent SDK.

The Agent SDK would supply built-in `Read`/`Glob` tools plus a permission layer, and
we would use that layer to deny `system-design/**/reference.md`, `solutions/**`, and
`patterns.md`. That works, but it is a deny-list guarding a capability the
interviewer does not need. The files each track requires are few and known before
the session starts:

| Track | Injected context |
|---|---|
| `mock` behavioral | `.claude/commands/mock.md`, `behavioral/competencies.md`, `behavioral/questions.md`, competency headings only from `local/stories.md` |
| `design --live` | `.claude/commands/design.md`, `system-design/<problem>/README.md`, `system-design/<problem>/rubric.md` |

The CLI reads those itself and injects them into the system prompt. The model is
given no tools at all, so the spoiler files are unreachable **by construction**
rather than by policy. That is a stronger guarantee than a permission deny-list,
and it drops a dependency.

It also lets one module enforce `rules/no-spoilers.md` mechanically instead of in
prose. `context.ts` owns a per-track allowlist and is the only thing in the system
that opens a file for the model. Everything else in the repo — `reference.md`,
`solutions/**`, `patterns.md`, and the *bodies* of `local/stories.md` — is
unreachable because nothing can ask for them.

The `local/stories.md` handling deserves its own note, because it converts a prose
rule into a mechanical one. `mock.md` says to read the story bank "**only** to see
which competencies have no story yet… Do not read the story you are about to ask
for." Under voice, `context.ts` parses the competency headings out and injects only
that list. The interviewer cannot check his answer against a script because it never
receives one.

### Turn-taking: continuous recording, Enter yields the turn

No voice-activity detection, and no hold-to-talk.

Silence detection is the obvious default and it is wrong here. `design.md` says
plainly: *"Let silence sit. Do not fill it. Thinking time is the exercise."* A VAD
threshold short enough to feel responsive will end his turn mid-thought during
exactly the pause the drill is designed to create. A threshold long enough to be
safe is slower than pressing a key.

So the mic records continuously from the start of the session. He talks; he presses
Enter when he is done with a turn. Nothing can truncate him. The pauses land in the
transcript with timestamps, which turns a liability into data — pacing and dead air
become measurable, where today they are invisible.

### Latency: stream, chunk at sentence boundaries

The model response is streamed. `interviewer.ts` accumulates text deltas, cuts at
sentence boundaries, and hands each completed sentence to `tts.ts` while the rest of
the response is still generating.

Without this, every interviewer turn costs a full generate-then-speak round trip
before the first word is audible. Over a 45-minute design drill that is the
difference between a conversation and a series of pauses.

`interviewer.ts` owns chunking. `tts.ts` receives strings and knows nothing about
streaming.

### Modules

Each has one job, a narrow interface, and is testable without a microphone.

| Module | Responsibility | Interface |
|---|---|---|
| `audio.ts` | mic capture → wav | `record(): Recorder` with `stop(): Promise<WavPath>` |
| `stt.ts` | transcription | `transcribe(wav): Promise<{text, segments}>` |
| `tts.ts` | speech output | `speak(text): Promise<void>` |
| `context.ts` | allowlisted reads → system prompt | `build(track, problem?): Promise<SystemPrompt>` |
| `interviewer.ts` | API loop, streaming, sentence chunking | `turn(history, utterance): AsyncIterable<Sentence>` |
| `transcript.ts` | session log in `local/` | `append(track, entry): Promise<void>` |
| `cli.ts` | arg parsing, wiring | — |

`stt.ts` and `tts.ts` are interfaces with one implementation each at first. Both
implementations are the parts most likely to be replaced, and both are replaceable
without touching anything else.

### Model configuration

- `claude-opus-5`
- Adaptive thinking, which is the default on this model — no `thinking` parameter is
  passed. Note this means `max_tokens` bounds thinking *plus* response text.
- `output_config: {effort: "medium"}`. The interviewer's job is asking one good
  question and then not filling the silence. Lower effort produces less preamble,
  which is precisely what a persona instructed never to preamble should have.
- Streaming, with `max_tokens` set generously since streaming removes the HTTP
  timeout concern.

### Toolchain choices

**STT — whisper.cpp, `large-v3-turbo`, run locally.** Verbatim transcription is the
entire reason not to use macOS dictation: dictation and the browser Web Speech API
both normalize away filler and false starts, which are what `/mock` grades. Running
locally also means interview audio never leaves the machine. The specific model is a
starting choice for the quality-versus-speed tradeoff on Apple Silicon and should be
benchmarked on the actual machine before it is settled; the interface makes swapping
it a one-file change.

**TTS — macOS `say`.** Free, local, instant, and robotic. It is good enough to prove
the loop works. If the synthetic voice measurably undercuts the pressure the drill
is meant to create, replacing it means one implementation of the `tts.ts` interface.

**Audio capture — ffmpeg with the avfoundation input device.** Already the common
denominator on macOS and avoids a native Node audio binding.

### Commands

```bash
pnpm mock:voice                  # behavioral, spoken
pnpm design:voice <problem>      # live design drill, spoken, 45 min default
```

Both write to `local/` in the same format the existing commands use, so a voice
session and a typed session are indistinguishable to `/status` and to the next
attempt at the same problem.

## Testing

The repo's standing rule is that a suite is only worth having if it fails the wrong
answer. Applied here:

- **`context.ts` spoiler gate.** A test asserts that every denied path —
  `system-design/*/reference.md`, `solutions/**`, `patterns.md` — is rejected by the
  allowlist, and that the `local/stories.md` parser emits competency headings with no
  story bodies. This is the test that has to have teeth: it should fail if someone
  later "helpfully" widens the allowlist.
- **Full loop with stubbed STT and TTS.** The conversation logic — turn ordering,
  history accumulation, transcript format — is testable with no microphone and no
  API call. Stub implementations of both interfaces make the loop a pure function of
  a scripted list of utterances.
- **Sentence chunker.** Given a stream of deltas, the chunker must emit complete
  sentences and must not split on abbreviations or decimals. Cheap to test, and
  wrong output is audible.

Deliberately not tested: whisper accuracy and `say` output. Those are the
implementations behind the interfaces, they are third-party, and asserting on them
would be testing someone else's software.

## Risks

- **STT latency per turn.** Local whisper on a long design answer is not instant. If
  the gap between "he presses Enter" and "the interviewer speaks" is bad enough to
  break the conversational feel, the mitigation is a streaming STT API behind the
  same interface — at the cost of a key, per-minute billing, and sending audio off
  the machine.
- **Synthetic voice reduces pressure.** Unknown until tried. Mitigated by the
  interface boundary.
- **Scope creep toward a whiteboard.** Explicitly out of scope above. If design
  drills feel crippled without one, that is a separate spec, not an addition to this
  one.
