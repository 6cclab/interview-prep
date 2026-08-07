# Voice Drills — Web UI

**Date:** 2026-08-07
**Status:** Approved, ready for planning
**Builds on:** `2026-08-07-voice-drills-design.md` (the terminal voice drills),
`2026-08-07-voice-ui-groundwork.md` (read-only survey of what is reusable)

## Problem

The voice drills work from a terminal. `pnpm mock:voice` records continuously,
transcribes with local whisper.cpp, streams an interviewer's reply, and speaks it
with macOS `say`. It also carries three costs that have nothing to do with the
skill being practised:

- **Turn-taking happens in a window nobody is looking at.** The drill asks Andre
  to talk for two minutes; the only affordance is pressing Enter in a terminal
  behind whatever he is actually reading.
- **Device selection is a hand-maintained index.** `local/voice.json` holds an
  avfoundation index. Get it wrong and the drill records silence and reports
  success — the failure mode `cli.ts` has to print a warning about, because
  nothing can detect it.
- **The design track has nowhere to put the problem statement.** A 45-minute
  design drill is graded on scoping and estimation against a prompt the solver
  cannot see while speaking.

A browser fixes all three as a side effect of the medium: `MediaRecorder`
mediates device selection through the OS picker, a page can show the transcript
as it accumulates, and a page has room for a problem statement.

## Scope

Behavioral (`/mock`) only. The design track follows once the turn loop has run a
real session; it is mostly reuse plus a timer and a problem pane, and building it
speculatively on an unproven loop buys nothing.

## Non-goals

Inherited from the terminal spec and **not reopened by the change of medium** —
each is listed because a browser implementation is the most likely place to
reintroduce it by accident, not because it is being reconsidered:

- **No voice-activity detection, and no auto-stop.** Turn-taking stays an
  explicit button press. Most browser recording examples default to VAD, which
  makes this the single easiest non-goal to violate without deciding to. The
  original reasoning is unchanged: *"Let silence sit. Do not fill it. Thinking
  time is the exercise."* A threshold short enough to feel responsive ends a turn
  mid-thought during exactly the pause the drill exists to create.
- **No whiteboard or drawing canvas.** A webpage is the most natural place to add
  one and the rubric still does not grade a diagram.
- **No barge-in or duplex.** Deferred, not rejected, exactly as before.
- **The terminal path stays.** `pnpm mock:voice` keeps working. The web UI is a
  third entry point to the same prompts, not a migration, and the shared session
  core below is what stops the two drifting apart.

Also out of scope: authentication, multi-user support, and any persistence beyond
the `local/` files the terminal path already writes.

## Architecture

### Zero new dependencies

The repo has one runtime dependency (`@anthropic-ai/sdk`) and no framework or
bundler. That is preserved: the server is `node:http` with a hand-rolled router
for five routes, and the client is one HTML file loading plain ES modules. No
build step, so there is nothing between the source and what runs.

This is a judgement about a single-user localhost tool, not a general principle.
Five routes do not justify a framework, and a bundler would add a build to a repo
whose entire toolchain today is `tsx` and `vitest`.

### The refactor: an explicit session object

This is the one structural change, and it is what makes the rest possible.

`runSession` in `voice/session.ts` runs the whole drill as a single async
function: `entries` lives in a closure, the loop is `for (;;)`, and each
iteration blocks on `deps.nextTurn()` — which in `cli.ts` is `rl.question('')`,
suspending the function until a human presses Enter. State lives on the JS call
stack for as long as the process runs. HTTP has no equivalent: nothing holds a
call stack open across two requests.

So the state moves off the stack into a `Session` object that both front ends
drive:

| Member | Responsibility |
|---|---|
| `submitTurn(said)` | Feed a transcribed turn; returns the interviewer's reply as an `AsyncIterable<string>` of speakable sentences |
| `entries()` | The transcript so far, as the existing `Entry[]` |
| `endedEarly()` | The existing early-end marker, unchanged in meaning |
| `end()` | Write the transcript, append the story log if a trailer is present |

`cli.ts` keeps its readline loop and drives this object; the server drives the
same object from route handlers. One turn loop, two callers. The existing
graceful-degradation behaviour moves with it: a failed turn still appends a
synthetic `[Session ended early — …]` entry, still sets the marker, and still
leaves the collected entries intact for `end()` to persist.

`runSession` remains as the CLI's thin driver over the new object, so the
terminal path's behaviour and its tests are preserved rather than reimplemented.

### Routes

Five, all bound to `127.0.0.1` explicitly — never `0.0.0.0`. A drill involves a
live microphone and reads the story bank; it has no business being reachable from
the network.

| Route | Does |
|---|---|
| `GET /` | Serves the page and its static assets |
| `POST /api/session` | Builds the system prompt, creates the `Session`, returns an id |
| `GET /api/session/:id/stream` | SSE. Pushes sentence events as the model produces them, plus session lifecycle events |
| `POST /api/session/:id/turn` | Accepts the recorded audio, transcodes it, transcribes it, runs the turn |
| `POST /api/session/:id/end` | Ends the session and persists |

SSE rather than a WebSocket: the streaming is one-directional (server pushes
sentences), and everything the browser needs to send is a discrete action that
maps onto an ordinary POST. A WebSocket would be the right call if barge-in were
in scope, and it is not.

Session state is an in-memory `Map` keyed by id. Sessions are ~45 minutes,
single-user, and a server restart losing an in-flight drill is an acceptable
outcome for a personal tool; an external store would be new infrastructure
bought for nothing.

### Audio

`MediaRecorder` produces an encoded container — commonly `audio/webm;codecs=opus`
— at whatever rate the input track negotiates. whisper.cpp needs 16 kHz mono PCM
wav, which the terminal path got for free because ffmpeg's capture invocation
produced it directly.

So the server transcodes: the uploaded blob goes to ffmpeg (already a system
dependency) and comes out as 16 kHz mono wav, which is handed to the existing
`whisperTranscriber` unchanged. The alternative — resampling in the browser via
Web Audio API — means new client-side audio code with no existing analogue in the
repo, to avoid a dependency the repo already has.

whisper.cpp cannot run in a browser regardless of format, so transcription stays
server-side either way. It also stays batch rather than streaming: a complete
turn's audio, then transcribe. That is unchanged by the medium.

### Speech

The browser speaks replies with `SpeechSynthesis`, which queues utterances
natively. The server therefore sends each sentence as soon as the chunker
produces it and lets the browser pace itself — no server-side estimate of speech
duration, which would be fragile and voice-dependent.

**Known loss:** `saySpeaker`'s `-a <device>` output-device selection has no
`SpeechSynthesis` equivalent. The browser uses the system default output. Input
device selection improves (the OS picker replaces a hand-maintained index);
output device selection regresses to an OS-level setting. This is a real
regression against a capability the terminal path has, accepted because the input
side is where the silent-failure mode lived.

### Client

One page. A record button, the transcript as it accumulates, and a session state
indicator. The transcript is rendered from `Entry` objects — see the spoiler
rules below for why that matters.

No framework: the interactive surface is one button and an append-only list.

## The spoiler gate under a client/server split

The terminal design's central claim is that spoiler files are unreachable **by
construction**: `context.ts` is the only thing that opens a file for the model,
and the model has no tools. Adding HTTP handlers adds the first code paths that
could carry file content to a client, so the guarantee needs explicit rules
rather than remaining an emergent property.

Three rules, each with a test that fails if it is violated:

1. **The assembled system prompt never appears in a response body.** It contains
   `mock.md`, the competency list, and the question bank. Today it stays
   server-side only because the process that builds it also holds the only
   channel that consumes it, and a human at a terminal has no way to ask for it
   back. An endpoint returning it for a debug or "inspect session" view is the
   most likely way this guarantee dies quietly.
2. **`interviewer.lastRaw()` never crosses the wire.** It contains the
   unstripped `story-log` trailer. The browser's transcript is built from `Entry`
   objects, which are already trailer-stripped by the sentence stream. `lastRaw()`
   is the obvious thing to reach for when displaying "the full last response" and
   is exactly the wrong thing to send.
3. **`problem` is validated at the HTTP boundary.** `PROBLEM_SLUG` already
   rejects anything outside `[a-z0-9-]`, and `assertNoSpoilers` independently
   rejects traversal. Both must run on the value as it arrives from a request.
   The reasoning that made the CLI safe — "it's Andre typing at his own
   terminal" — stops applying the moment the value arrives over HTTP.

Rule 1 gets the teeth test: assert no endpoint's response contains a known
string from a denied file, and prove the test fails when a debug field is added.
A test that cannot fail is not a gate.

`competencyCoverage`'s heading-only parse of `local/stories.md` stays
server-side. Serving the file's bytes to the browser to extract headings there
would defeat the mechanism regardless of how careful the client code is.

## Failure modes

- **A turn fails** (whisper missing, ffmpeg dies, the model errors): the existing
  graceful-degradation path applies unchanged — the session ends early, the
  synthetic entry is appended, and every collected entry is still persisted. The
  browser is told, rather than left with a page that silently stops responding.
- **The tab closes mid-drill.** This has no analogue in the terminal path, where
  closing the terminal kills the process and `cli.ts`'s `finally` runs as normal
  shutdown. An HTTP server outliving its client is the default. So: SSE
  disconnect auto-ends the session and persists whatever entries exist, matching
  the existing "never discard collected entries" philosophy.
- **A session whose client vanished without a clean disconnect** is reaped by an
  idle timeout, which ends and persists it the same way.
- **A second session started while one is live** is refused rather than
  silently replacing it, so an abandoned tab cannot quietly discard a drill in
  progress.

## Testing

Following the repo's standing rule that a suite is only worth having if it fails
the wrong answer:

- **The session object** is tested through the same stubbed seams the terminal
  path uses — a scripted `StreamFn`, a stub transcriber, a stub speaker. The turn
  loop, the early-end behaviour, and transcript persistence are all covered with
  no microphone and no API call.
- **The routes** are tested against an in-process server with those same stubs,
  asserting status codes, the SSE event sequence, and the session lifecycle.
- **The spoiler gate** gets the test that has to have teeth: sweep every
  endpoint's responses for content from denied files and for the raw trailer.
  Prove it by adding a debug field that leaks the prompt and confirming the test
  goes red.
- **`PROBLEM_SLUG` at the boundary** is tested with traversal and absolute-path
  payloads arriving as request values.

Deliberately not tested: `MediaRecorder`, `SpeechSynthesis`, whisper accuracy,
and ffmpeg's transcode fidelity. These are browser and third-party
implementations behind interfaces; asserting on them is testing someone else's
software. The consequence is that the browser half needs one manual run to be
believed — the terminal path already carries this same caveat and it should not
be presented as covered.

## Risks

- **Nothing in the voice feature has completed a real session.** The terminal
  path is verified end to end on text turns and against synthetic speech, but no
  human has spoken into it. This spec builds a second front end on that loop, so
  a defect in the shared core surfaces in both. Accepted deliberately; the shared
  session object at least means such a defect gets fixed once.
- **Browser recording quality is unknown** relative to ffmpeg's direct 16 kHz
  capture. If opus transcoding measurably degrades whisper's accuracy, the
  mitigation is capture parameters, and the interface boundary means it does not
  spread.
- **`SpeechSynthesis` voices vary by platform and are generally worse than
  macOS `say`.** The terminal spec already flags synthetic voice quality as a
  risk to the pressure the drill creates; this can only make it more so.
