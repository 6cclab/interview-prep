# Plan — `/live`: own-microphone capture for real interviews

_Written 2026-08-25. Implementation plan; not implemented._

## The problem this solves

Every finding about how Andre performs in a real round is currently reconstructed from memory, a
day or more later. That has been wrong twice in the drill log's own records:

- `kth-largest-stream` 2026-08-17 logged **`no`, 2 hints, "stopped before implementing"** — the
  archived file was fully correct and passed **307/307** against a brute-force oracle.
- `valid-parentheses` 2026-08-18 logged **rung 4, unconfirmed** — the code he wrote was correct and
  he ended the session not knowing it.

Both were self-report after the fact, and both **understated him**. The CrowdStrike round on
2026-08-19 has the same problem in the other direction: three days of reasoning about whether the
gap is technical depth or clock conversion, from two sentences of recruiter paraphrase.

The fix is a primary record made at minute zero instead of a reconstruction made the next day.

## Scope

**In:** capture of **Andre's own microphone only**, local transcription, a summary, and a written
artifact per session.

**Out, and deliberately:** any capture of the interviewer's audio. See Legal below — this is the
constraint the whole design is shaped around, not a footnote.

## Legal constraint, and how the design enforces it

Recording your own microphone is not interception. You are a party to the conversation and your own
speech is yours. Recording the **other** side is governed by wiretap law, and the counterparties are
routinely in all-party-consent states (California for CrowdStrike and Hims; Talkspace is NY plus
Israel). The conservative rule for interstate calls is all-party consent, and separately many
companies prohibit recording in their interview terms.

Two things make "mic only" true in fact rather than in intent:

1. **Headphones are mandatory.** On speakers, the microphone picks up the interviewer through the
   room and the distinction collapses. The tool must refuse to start without confirming this.
2. **Loopback devices are a hard block.** BlackHole, Loopback, Soundflower, and macOS aggregate
   devices exist to capture system audio — i.e. the other party. If the selected input matches one,
   **abort with an explanation.** Do not warn-and-continue.

Neither check is security. Both are there so the tool cannot quietly become the thing it must not be.

## Architecture

Reuse what exists. Nothing here needs new capture, transcription, or storage primitives.

| Need | Existing module | Notes |
|---|---|---|
| Mic enumeration | `voice/devices.ts` — `listInputDevices()`, `listOutputDevices()` | already parses `avfoundation` |
| Device persistence | `readDeviceConfig(root)` / `writeDeviceConfig(root, patch)` | reuse, do not fork |
| Capture | `voice/audio.ts` — `record(dir, device, binary)` | 16 kHz mono PCM, whisper-native, **no silence detection** |
| Transcription | `voice/speech.ts` — `whisperTranscriber({binary, model})` | local `ggml-large-v3-turbo` |
| Summary model | `voice/backend.ts` — `modelFor()`, `describeBackend()` | same resolution as the mock tracks |
| Artifact write | `voice/transcript.ts` — `writeSession(root, relPath, body)` | collision-safe, returns the path actually used |
| Drill log | `voice/transcript.ts` — `appendDrillLog(root, row)` | optional, see Phase 4 |

### Do not extend the `Track` union

`Track` (`voice/context.ts:19`) drives `allowedPaths()` and the spoiler gate — machinery that exists
to stop a coding agent reading `solutions/` during a drill. A real interview has no spoilable answer
and no agent fence. Adding `'live'` there buys nothing and touches the gate.

Write a local `livePath(company, startedAt)` returning `local/live/<company>-<isoStamp>.md`, and call
`writeSession` with it directly. `writeSession` takes a relative path, not a `Track`.

### Segment the capture — do not reuse `record()` unchanged

`record()` spawns one ffmpeg for the whole session and produces one wav. For a 45–60 minute round
that is ~115 MB, which is fine, but **a crash at minute 50 loses everything**, and that is the exact
failure this tool exists to prevent.

Add `recordSegmented(dir, device, binary, seconds = 300)`:

```
-f avfoundation -i <device> -ar 16000 -ac 1
-f segment -segment_time 300 -reset_timestamps 1
<dir>/seg-%03d.wav
```

Each closed segment is a complete wav on disk. A crash costs at most the open segment. Transcribe
segments in order and concatenate, which also lets transcription start while recording continues.

## Two modes, one artifact

**`--live`** — start before the round, stop after. Captures his half in real time. Nothing depends
on recall.

**`--debrief`** — a five-minute spoken reconstruction immediately after. The fallback for rounds
where recording is contractually prohibited or simply unwise.

Both produce the same file shape, with a `mode:` field. `--debrief` is not a lesser feature; for
anything where the terms are unclear it is the correct default.

## Output artifact

`local/live/<company>-<isoStamp>.md`:

```markdown
# {Company} — {round}, {date}

mode: live | debrief
duration: 47m
device: MacBook Pro Microphone
model: ggml-large-v3-turbo

## Summary
{model-generated, see prompt below}

## Open questions
{gaps the model flagged — see below}

## Transcript (own microphone only)
{concatenated segment transcripts, timestamped}
```

### The summary prompt matters more than the pipeline

A generic "summarise this" wastes the artifact. Ask for the four things the record actually needs,
and require the model to mark inference:

1. **Questions asked**, reconstructed from his answers, each flagged `heard` or `inferred`.
2. **Where he stalled** — long gaps, restarts, self-corrections, audible dead air.
3. **What he narrated versus what he only did** — the distinction the `/assisted` track grades.
4. **Anything he said that he should be held to** in a later round.

Then: **"List what you could not determine from one side of the conversation."** That list is the
prompt for his own notes and stops the summary reading as complete when it is half a conversation.

## Phases

**Phase 1 — capture (the whole value).** `recordSegmented`, the loopback block, the headphone
confirmation, `livePath`, write the raw transcript. Ship this alone if time runs short: a raw
own-side transcript already beats next-day recall.

**Phase 2 — summary.** Wire `backend.ts`, add the prompt above, fill `## Summary` and
`## Open questions`.

**Phase 3 — `--debrief`.** Same pipeline, shorter session, different header. Nearly free once
Phase 1 exists.

**Phase 4 — drill-log row (optional).** `appendDrillLog` for rounds that were coding rounds. Keep
`hints: n/a` — there is no coach in a real interview, the same convention the 2026-08-19 CrowdStrike
row already uses.

## Tests

Follow the repo's existing pattern — pure functions tested directly, no live ffmpeg or whisper.

- `ffmpegSegmentArgs()` — emits `-f segment`, `-segment_time`, `-reset_timestamps 1`, 16 kHz mono.
- `isLoopbackDevice()` — matches BlackHole / Loopback / Soundflower / Aggregate / Multi-Output,
  case-insensitively; does **not** match "MacBook Pro Microphone" or a normal USB interface.
- `livePath()` — slugifies the company, stamps the date, stays under `local/live/`.
- Segment ordering — `seg-002` before `seg-010` (numeric, not lexicographic; this is the obvious bug).
- Summary parsing — the `## Open questions` section survives a model that omits it.

## Risks

- **The loopback block is the load-bearing safety property.** Test it first and test it hardest.
  Everything else is convenience.
- **Whisper on 45 minutes is slow.** Transcribe segments as they close rather than in one pass at the
  end, or the artifact is not ready when it is most useful.
- **Scope creep into diarization or interviewer capture.** Both are out. If either becomes tempting,
  that is the signal to stop and re-read the Legal section.
- **`local/` is gitignored and there is no undo.** `writeSession` already suffixes rather than
  clobbers; use its return value, never the path passed in.

## What this does not fix

It records what he said, not what they thought. The CrowdStrike question — was it depth or clock
conversion — would still have needed the recruiter's answer. This narrows the guessing; it does not
end it.

## Friday, 2026-08-28

Talkspace is a live coding round on his own machine with screen share. Phase 1 plus `--debrief`
is enough to make it a measured event rather than a remembered one, and the hypothesis being tested
is specific: **does an AI coding tool close the documented distance between his analysis and his
working code?** A debrief recorded five minutes after answers that with evidence.

**This should not displace running the `/assisted` mock.** The mock is the rehearsal; this is the
instrumentation. If only one happens this week, run the mock.
