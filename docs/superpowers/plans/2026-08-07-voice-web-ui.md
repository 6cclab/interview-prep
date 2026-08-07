# Voice Drills — Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the behavioral (`/mock`) voice drill a browser front end — a record button, a live transcript, and browser-native mic/speech — without breaking the terminal path (`pnpm mock:voice`) or adding a runtime dependency.

**Architecture:** Extract the state that `runSession` currently holds on the JS call stack into an explicit `Session` object (`voice/session.ts`). `runSession` becomes a thin driver over that object so the terminal path and its 142 existing tests are untouched. A new `node:http` server (`voice/http-server.ts`) drives the same `Session` object from five hand-rolled routes, using Server-Sent Events to push the interviewer's streamed reply and a small vanilla-JS page (`voice/public/`) to record with `MediaRecorder`, speak with `SpeechSynthesis`, and render the transcript from `Entry` objects only.

**Tech Stack:** TypeScript, `node:http`, `node:child_process` (ffmpeg), Vitest. Zero new npm dependencies — the only runtime dependency remains `@anthropic-ai/sdk`.

## Global Constraints

- One runtime dependency (`@anthropic-ai/sdk`) and no framework or bundler — the server is `node:http` with a hand-rolled router, the client is plain ES modules, no build step.
- Servers bind to `127.0.0.1` explicitly, never `0.0.0.0`.
- Scope is behavioral (`/mock`) only. `/design` is explicitly deferred — do not add design-track routes, a problem pane, or a timer.
- No voice-activity detection and no auto-stop — turn-taking stays an explicit button press, mirroring the terminal path's "press Enter."
- No whiteboard/canvas, no barge-in/duplex. The terminal path (`pnpm mock:voice`) keeps working unmodified.
- `context.ts`'s `buildSystemPrompt` stays the only function that reads a spoiler-adjacent file into a string bound for the model or a response body. No second read path.
- `interviewer.lastRaw()` (the unstripped `story-log` trailer) must never cross the wire to the browser.
- Vitest is the only test runner; commands are `pnpm vitest run <path>` and `pnpm typecheck`. `pnpm test` (full repo) fails ~28 suites *by design* (unsolved practice drills that ship red) — no task's gate is "all tests pass repo-wide."
- Commits carry no `Co-Authored-By` or AI-attribution trailer of any kind.

---

## File Structure

| File | Responsibility |
|---|---|
| `voice/session.ts` | *(modified)* Adds `createSession`/`Session`/`finishSession`. `runSession` becomes a driver over `createSession`; its exported signature and `SessionOutcome` return shape are unchanged. |
| `voice/session.test.ts` | *(modified — additive only)* Existing `describe('runSession', ...)` block untouched. New `describe('createSession', ...)` and `describe('finishSession', ...)` blocks added. |
| `voice/transcode.ts` | *(new)* Pure `ffmpegTranscodeArgs()` builder plus `transcodeToWav()`, which shells out to `ffmpeg` to convert an uploaded webm/opus blob to 16 kHz mono wav. |
| `voice/transcode.test.ts` | *(new)* Tests `ffmpegTranscodeArgs()` only — mirrors the repo's existing convention (`audio.ts`/`speech.ts`) of testing argv builders, not the subprocess itself. |
| `voice/session-store.ts` | *(new)* In-memory `Map`-backed store of live sessions, keyed by id. Enforces "one session at a time," tracks last-activity for idle reap, owns each session's scratch directory. |
| `voice/session-store.test.ts` | *(new)* Store behaviour: create/get/remove, the single-active-session refusal, idle reap selection. |
| `voice/http-server.ts` | *(new)* `createVoiceServer()` — the hand-rolled router: static file serving plus the five `/api/session*` routes. Exports a `main()` guarded by `import.meta.url` so `tsx voice/http-server.ts` runs it directly, exactly like `cli.ts`. |
| `voice/http-server.test.ts` | *(new)* Binding (127.0.0.1), static routes, 404s. |
| `voice/session-routes.test.ts` | *(new)* `POST /api/session`, `GET /api/session/:id/stream`, `POST /api/session/:id/turn`, `POST /api/session/:id/end` against an in-process server with stub transport/transcriber. |
| `voice/spoiler-gate.test.ts` | *(new)* The teeth test: sweeps every route's response bytes for denied-file content and the raw trailer. Includes the falsification step (add a leak, watch it fail, remove it) as an explicit, reverted step — not part of the file's final content. |
| `voice/test-helpers/sse.ts` | *(new)* Shared test-only helper: reads one Server-Sent Event at a time off a `fetch()` response body. Not a `*.test.ts` file, so Vitest does not try to run it as a suite. |
| `voice/public/index.html` | *(new)* The one page: record button, transcript list, session status line. |
| `voice/public/app.js` | *(new)* Plain ES module: `MediaRecorder` capture, `EventSource` consumption, `SpeechSynthesis` playback, transcript rendering from `Entry`-shaped SSE payloads only. |
| `voice/public/style.css` | *(new)* Minimal styling — not a design deliverable, just enough to make record/idle/speaking states visually distinct. |
| `package.json` | *(modified)* Adds `"mock:web": "tsx voice/http-server.ts"`. |

`voice/cli.ts`, `voice/context.ts`, `voice/interviewer.ts`, `voice/transcript.ts`, `voice/speech.ts`, `voice/chunk.ts`, `voice/audio.ts`, `voice/devices.ts`, `voice/claude-cli.ts` are **not modified** anywhere in this plan.

---

### Task 1: Extract `Session` from `runSession`, preserving `runSession`'s exact contract

**Files:**
- Modify: `voice/session.ts` (full rewrite of the module body; exported names `runSession`, `SessionDeps`, `SessionOutcome` keep their existing shapes)
- Test: `voice/session.test.ts` — **do not modify this file in this task.** It is the proof: if any of its 9 existing tests need to change, the refactor is wrong.

**Interfaces:**
- Produces:
  - `export interface Session { begin(): AsyncIterable<string>; submitTurn(said: string): AsyncIterable<string>; entries(): Entry[]; endedEarly(): string | undefined; reportFailure(message: string): void }`
  - `export interface CreateSessionOptions { interviewer: Interviewer; now(): number }`
  - `export function createSession(opts: CreateSessionOptions): Session`
  - `export interface FinishOptions { root: string; track: Track; problem?: string; startedAt: Date }`
  - `export interface FinishResult { relPath: string; storyLogWritten: boolean }`
  - `export function finishSession(session: Session, interviewer: Interviewer, opts: FinishOptions): FinishResult`
  - `export interface SessionDeps { ... }` (unchanged from today)
  - `export type SessionOutcome = Entry[] & { endedEarly?: string }` (unchanged)
  - `export async function runSession(deps: SessionDeps): Promise<SessionOutcome>` (same signature, same behaviour)

Why `begin()` exists alongside `submitTurn()`, beyond the spec's four-member table: the very first interviewer turn (`"Begin the interview."`) never produces an Andre transcript entry — nothing was transcribed yet. Folding that into `submitTurn` would mean special-casing a sentinel string inside it. `begin()` keeps `submitTurn`'s contract literal ("feed a transcribed turn") and keeps `entries()` a pure read accessor that no caller mutates directly.

- [ ] **Step 1: Read the current file once more to confirm the exact call/push ordering `runSession` relies on**

Already read in full during planning — the two-writes-per-full-cycle pattern (`entries.push(interviewer, at)` after speaking, then `entries.push(andre, heardAt)` after transcribing) is what the new `Session` must reproduce call-for-call, since `session.test.ts`'s `'stamps each entry with elapsed time'` test asserts the exact sequence of `now()` outputs landing on entries in order `[500, 1000, 1500]`.

- [ ] **Step 2: Write `voice/session.ts`**

```typescript
import type { Interviewer } from './interviewer'
import type { Recorder } from './audio'
import type { Speaker, Transcriber } from './speech'
import type { Track } from './context'
import { appendStoryLog, formatSession, sessionPath, splitTrailer, writeSession, type Entry } from './transcript'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const OPENING = 'Begin the interview.'

/**
 * The turn engine, extracted off the JS call stack `runSession` used to hold
 * it on. `begin()` and `submitTurn()` both stream the interviewer's reply one
 * speakable sentence at a time and commit exactly one interviewer `Entry` when
 * the reply completes; `submitTurn()` additionally commits the Andre `Entry`
 * for the text it was fed, immediately, before the interviewer replies. A
 * failed turn — the interviewer's stream throwing or returning nothing —
 * appends the same synthetic `[Session ended early — ...]` marker `runSession`
 * has always produced, sets `endedEarly()`, and stops yielding; it does not
 * throw, so both `runSession` and the HTTP routes can treat "the async
 * iterable simply ended" and "it ended because of a failure" as the same
 * shape, distinguished by checking `endedEarly()` afterwards.
 */
export interface Session {
  /** The interviewer's first turn. No Andre entry is recorded for it. */
  begin(): AsyncIterable<string>
  /** Feed a transcribed turn; yields the interviewer's reply as speakable sentences. */
  submitTurn(said: string): AsyncIterable<string>
  /** The transcript so far. */
  entries(): Entry[]
  /** Set once a turn has failed; the message named in the synthetic entry. */
  endedEarly(): string | undefined
  /**
   * Record a failure that happened before any text existed to feed
   * `submitTurn` — a failed audio transcode or transcription. Produces the
   * same synthetic entry and marker `submitTurn`'s own catch path does.
   */
  reportFailure(message: string): void
}

export interface CreateSessionOptions {
  interviewer: Interviewer
  /** Milliseconds since the session started. */
  now(): number
}

export function createSession(opts: CreateSessionOptions): Session {
  const entries: Entry[] = []
  let earlyMarker: string | undefined

  function reportFailure(message: string): void {
    entries.push({ speaker: 'interviewer', text: `[Session ended early — ${message}]`, at: opts.now() })
    earlyMarker = message
    console.error(`Voice session ended early: ${message}`)
  }

  async function* runInterviewerTurn(said: string): AsyncIterable<string> {
    const at = opts.now()
    const spoken: string[] = []
    try {
      for await (const sentence of opts.interviewer.turn(said)) {
        spoken.push(sentence)
        yield sentence
      }
    } catch (error) {
      reportFailure(errorMessage(error))
      return
    }
    entries.push({ speaker: 'interviewer', text: spoken.join(' '), at })
  }

  return {
    begin(): AsyncIterable<string> {
      return runInterviewerTurn(OPENING)
    },
    submitTurn(said: string): AsyncIterable<string> {
      entries.push({ speaker: 'andre', text: said, at: opts.now() })
      return runInterviewerTurn(said)
    },
    entries: () => entries,
    endedEarly: () => earlyMarker,
    reportFailure,
  }
}

/**
 * Persist a session's transcript, and its story-log trailer for `mock`. This
 * is the web path's equivalent of what `cli.ts` does inline once `runSession`
 * returns; `cli.ts` is left calling `transcript.ts` directly and is untouched
 * by this function's existence.
 */
export interface FinishOptions {
  root: string
  track: Track
  problem?: string
  startedAt: Date
}

export interface FinishResult {
  relPath: string
  storyLogWritten: boolean
}

export function finishSession(session: Session, interviewer: Interviewer, opts: FinishOptions): FinishResult {
  const relPath = sessionPath(opts.track, opts.startedAt, opts.problem)
  writeSession(opts.root, relPath, formatSession(session.entries(), opts.startedAt))

  let storyLogWritten = false
  if (opts.track === 'mock') {
    const { log } = splitTrailer(interviewer.lastRaw())
    if (log) {
      appendStoryLog(opts.root, log)
      storyLogWritten = true
    }
  }
  return { relPath, storyLogWritten }
}

export interface SessionDeps {
  transcriber: Transcriber
  speaker: Speaker
  interviewer: Interviewer
  startRecording(): Recorder
  /** Resolves when Andre yields the turn, or 'end' to finish the session. */
  nextTurn(): Promise<'speak' | 'end'>
  /** Milliseconds since the session started. */
  now(): number
}

export type SessionOutcome = Entry[] & { endedEarly?: string }

function outcomeOf(session: Session): SessionOutcome {
  const outcome = session.entries() as SessionOutcome
  const marker = session.endedEarly()
  if (marker) outcome.endedEarly = marker
  return outcome
}

/**
 * One drill, start to finish, driven over the shared `Session` turn engine.
 * The interviewer speaks first; after that every cycle is: record until Andre
 * yields, transcribe, feed the turn, speak the reply. Behaviour is unchanged
 * from before the `Session` extraction — see `session.test.ts`, which is not
 * modified by this refactor.
 */
export async function runSession(deps: SessionDeps): Promise<SessionOutcome> {
  const session = createSession({ interviewer: deps.interviewer, now: deps.now })

  for await (const sentence of session.begin()) {
    await deps.speaker.speak(sentence)
  }
  if (session.endedEarly()) return outcomeOf(session)

  for (;;) {
    const recorder = deps.startRecording()
    const decision = await deps.nextTurn()

    let wavPath: string
    try {
      wavPath = await recorder.stop()
    } catch (error) {
      session.reportFailure(`recording failed: ${errorMessage(error)}`)
      return outcomeOf(session)
    }
    if (decision === 'end') return outcomeOf(session)

    let utteranceText: string
    try {
      const utterance = await deps.transcriber.transcribe(wavPath)
      utteranceText = utterance.text
    } catch (error) {
      session.reportFailure(`transcription failed: ${errorMessage(error)}`)
      return outcomeOf(session)
    }

    for await (const sentence of session.submitTurn(utteranceText)) {
      await deps.speaker.speak(sentence)
    }
    if (session.endedEarly()) return outcomeOf(session)
  }
}
```

- [ ] **Step 3: Run the existing suite to confirm nothing broke**

Run: `pnpm vitest run voice/session.test.ts -v`
Expected: `9 passed (9)` — the same 9 tests that pass today, unmodified.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. `cli.ts` imports `runSession` and `SessionOutcome` from `./session` — both keep their exact prior shape, so this should be a no-op for `cli.ts`.

- [ ] **Step 5: Commit**

```bash
git add voice/session.ts
git commit -m "refactor(voice): extract Session turn engine, keep runSession's contract"
```

---

### Task 2: Direct tests for `createSession` and `finishSession`

**Files:**
- Modify: `voice/session.test.ts` (append only — the existing `describe('runSession', ...)` block is untouched)

**Interfaces:**
- Consumes: `createSession`, `finishSession`, `Session`, `CreateSessionOptions`, `FinishOptions` from Task 1.

The web path drives `Session` directly, not through `runSession`, so it needs its own coverage — `runSession`'s tests only prove the CLI's usage pattern, not `begin()`/`submitTurn()`/`reportFailure()`/`finishSession()` in isolation.

- [ ] **Step 1: Add the new tests**

Append to `voice/session.test.ts` (after the existing `describe('runSession', ...)` block, same file, same imports already present plus the two below):

```typescript
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, finishSession } from './session'

describe('createSession', () => {
  function fakeInterviewer(replies: string[]): Interviewer {
    let index = 0
    return {
      async *turn() {
        for (const sentence of (replies[index] ?? '').split('|')) yield sentence
        index++
      },
      lastRaw: () => replies[index - 1] ?? '',
    }
  }

  it('begin() yields the opening reply and records no Andre entry', async () => {
    const session = createSession({ interviewer: fakeInterviewer(['Ready when you are.']), now: () => 0 })
    const sentences: string[] = []
    for await (const s of session.begin()) sentences.push(s)
    expect(sentences).toEqual(['Ready when you are.'])
    expect(session.entries()).toEqual([{ speaker: 'interviewer', text: 'Ready when you are.', at: 0 }])
  })

  it('submitTurn() records the Andre entry immediately, before the reply arrives', async () => {
    let ticks = 0
    const session = createSession({ interviewer: fakeInterviewer(['Go on.']), now: () => (ticks += 100) })
    const iter = session.submitTurn('Ready latency.')
    const first = await iter[Symbol.asyncIterator]().next()
    expect(first.value).toBe('Go on.')
    expect(session.entries()[0]).toEqual({ speaker: 'andre', text: 'Ready latency.', at: 100 })
  })

  it('endedEarly() is unset after a normal turn', async () => {
    const session = createSession({ interviewer: fakeInterviewer(['Fine.']), now: () => 0 })
    for await (const _ of session.begin()) void _
    expect(session.endedEarly()).toBeUndefined()
  })

  it('a failing interviewer turn ends the session and leaves a synthetic entry', async () => {
    const failing: Interviewer = {
      async *turn() {
        throw new Error('stream exploded')
      },
      lastRaw: () => '',
    }
    const session = createSession({ interviewer: failing, now: () => 42 })
    const sentences: string[] = []
    for await (const s of session.begin()) sentences.push(s)
    expect(sentences).toEqual([])
    expect(session.endedEarly()).toBe('stream exploded')
    expect(session.entries()[0]!.text).toMatch(/ended early.*stream exploded/i)
  })

  it('reportFailure() marks the session ended without needing a turn', () => {
    const session = createSession({ interviewer: fakeInterviewer([]), now: () => 7 })
    session.reportFailure('transcode failed')
    expect(session.endedEarly()).toBe('transcode failed')
    expect(session.entries()).toEqual([
      { speaker: 'interviewer', text: '[Session ended early — transcode failed]', at: 7 },
    ])
  })
})

describe('finishSession', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'voice-finish-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('writes the transcript to local/mock-<date>.md', () => {
    const session = createSession({ interviewer: { turn: async function* () {}, lastRaw: () => '' }, now: () => 0 })
    session.submitTurn('Ready latency.')
    const startedAt = new Date('2026-08-07T10:00:00.000Z')
    const { relPath } = finishSession(session, { turn: async function* () {}, lastRaw: () => '' }, {
      root,
      track: 'mock',
      startedAt,
    })
    expect(relPath).toBe('local/mock-2026-08-07.md')
    expect(readFileSync(join(root, relPath), 'utf8')).toContain('Ready latency.')
  })

  it('appends the story log when the interviewer emitted a trailer', () => {
    const session = createSession({ interviewer: { turn: async function* () {}, lastRaw: () => '' }, now: () => 0 })
    const raw = '```story-log\ncompetency: Conflict\nstory: The migration\nworked: Owned the timeline\nfix: Name the tradeoff sooner\n```'
    const { storyLogWritten } = finishSession(session, { turn: async function* () {}, lastRaw: () => raw }, {
      root,
      track: 'mock',
      startedAt: new Date('2026-08-07T10:00:00.000Z'),
    })
    expect(storyLogWritten).toBe(true)
    expect(readFileSync(join(root, 'local/stories.md'), 'utf8')).toContain('## Conflict')
  })

  it('does not write a story log when the interviewer emitted no trailer', () => {
    const session = createSession({ interviewer: { turn: async function* () {}, lastRaw: () => '' }, now: () => 0 })
    const { storyLogWritten } = finishSession(session, { turn: async function* () {}, lastRaw: () => 'No trailer here.' }, {
      root,
      track: 'mock',
      startedAt: new Date('2026-08-07T10:00:00.000Z'),
    })
    expect(storyLogWritten).toBe(false)
  })
})
```

- [ ] **Step 2: Run the file**

Run: `pnpm vitest run voice/session.test.ts -v`
Expected: `18 passed (18)` (9 existing `runSession` tests + 9 new ones across `createSession`/`finishSession`).

- [ ] **Step 3: Commit**

```bash
git add voice/session.test.ts
git commit -m "test(voice): cover createSession and finishSession directly"
```

---

### Task 3: Audio transcode — webm/opus to 16 kHz mono wav

**Files:**
- Create: `voice/transcode.ts`
- Test: `voice/transcode.test.ts`

**Interfaces:**
- Produces: `export function ffmpegTranscodeArgs(inputPath: string, outputPath: string): string[]`, `export async function transcodeToWav(inputPath: string, outputPath: string, binary?: string): Promise<void>`

`MediaRecorder` produces `audio/webm;codecs=opus` (browser-dependent container/codec) at whatever rate the input track negotiated — not the 16 kHz mono PCM whisper.cpp needs. `ffmpeg` (already a system dependency per `audio.ts`) auto-detects the input container from its bytes, so no `-f` flag is needed on the input side, only on the output shape.

- [ ] **Step 1: Write the failing test**

```typescript
// voice/transcode.test.ts
import { describe, expect, it } from 'vitest'
import { ffmpegTranscodeArgs } from './transcode'

describe('ffmpegTranscodeArgs', () => {
  it('resamples to 16kHz mono and overwrites the output', () => {
    expect(ffmpegTranscodeArgs('/tmp/turn.webm', '/tmp/turn.wav')).toEqual([
      '-hide_banner',
      '-loglevel', 'error',
      '-i', '/tmp/turn.webm',
      '-ar', '16000',
      '-ac', '1',
      '-y',
      '/tmp/turn.wav',
    ])
  })

  it('does not force an input container — ffmpeg auto-detects webm/opus from the bytes', () => {
    const args = ffmpegTranscodeArgs('/tmp/turn.webm', '/tmp/turn.wav')
    expect(args).not.toContain('-f')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run voice/transcode.test.ts -v`
Expected: FAIL — `Cannot find module './transcode'` (the file doesn't exist yet).

- [ ] **Step 3: Write `voice/transcode.ts`**

```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * whisper.cpp's native input format is 16kHz mono PCM wav. `ffmpeg` auto-
 * detects the input container from its bytes, so no `-f` is passed on the
 * input side — only the output shape is forced.
 */
export function ffmpegTranscodeArgs(inputPath: string, outputPath: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    '-y',
    outputPath,
  ]
}

/**
 * Converts an uploaded browser recording (commonly webm/opus, but whatever
 * container `MediaRecorder` produced) to the wav shape `whisperTranscriber`
 * expects. Deliberately not tested beyond the argv it builds — asserting on
 * ffmpeg's actual transcode fidelity would be testing third-party software,
 * same standing exception the repo already makes for `say` and whisper.cpp
 * themselves.
 */
export async function transcodeToWav(inputPath: string, outputPath: string, binary = 'ffmpeg'): Promise<void> {
  try {
    await run(binary, ffmpegTranscodeArgs(inputPath, outputPath))
  } catch (err) {
    throw new Error(`ffmpeg transcode failed (input: ${inputPath})`, { cause: err })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run voice/transcode.test.ts -v`
Expected: `2 passed (2)`

- [ ] **Step 5: Commit**

```bash
git add voice/transcode.ts voice/transcode.test.ts
git commit -m "feat(voice): add ffmpeg webm/opus to 16kHz mono wav transcode"
```

---

### Task 4: Session store — single active session, idle reap

**Files:**
- Create: `voice/session-store.ts`
- Test: `voice/session-store.test.ts`

**Interfaces:**
- Consumes: `Session`, `Interviewer` from `voice/session.ts` / `voice/interviewer.ts`.
- Produces:
  ```typescript
  export interface StoredSession {
    id: string
    session: Session
    interviewer: Interviewer
    startedAt: Date
    scratchDir: string
    sseClient?: ServerResponse
    lastActivity: number
  }
  export interface SessionStore {
    create(session: Session, interviewer: Interviewer, startedAt: Date, scratchDir: string): StoredSession
    get(id: string): StoredSession | undefined
    remove(id: string): void
    hasActive(): boolean
    touch(id: string, now: number): void
    reapIdle(now: number, idleMs: number): StoredSession[]
  }
  export function createSessionStore(idFactory?: () => string): SessionStore
  ```

Later tasks (5–9) hold `ServerResponse` values from `node:http`; the store's own tests use a minimal stub shape rather than a real socket.

- [ ] **Step 1: Write the failing test**

```typescript
// voice/session-store.test.ts
import { describe, expect, it } from 'vitest'
import { createSessionStore } from './session-store'
import type { Interviewer } from './interviewer'
import type { Session } from './session'

function fakeSession(): Session {
  return {
    begin: async function* () {},
    submitTurn: async function* () {},
    entries: () => [],
    endedEarly: () => undefined,
    reportFailure: () => {},
  }
}

const fakeInterviewer: Interviewer = { turn: async function* () {}, lastRaw: () => '' }

describe('createSessionStore', () => {
  it('assigns ids from the injected factory', () => {
    let n = 0
    const store = createSessionStore(() => `id-${++n}`)
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch-1')
    expect(stored.id).toBe('id-1')
  })

  it('get() finds a stored session by id', () => {
    const store = createSessionStore(() => 'abc')
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch')
    expect(store.get('abc')).toBe(stored)
  })

  it('get() returns undefined for an unknown id', () => {
    const store = createSessionStore()
    expect(store.get('nope')).toBeUndefined()
  })

  it('reports no active session before any is created', () => {
    expect(createSessionStore().hasActive()).toBe(false)
  })

  it('reports an active session once one exists', () => {
    const store = createSessionStore()
    store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch')
    expect(store.hasActive()).toBe(true)
  })

  it('remove() clears the session so hasActive() goes false again', () => {
    const store = createSessionStore(() => 'abc')
    store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch')
    store.remove('abc')
    expect(store.hasActive()).toBe(false)
    expect(store.get('abc')).toBeUndefined()
  })

  it('touch() updates lastActivity', () => {
    const store = createSessionStore(() => 'abc')
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch')
    store.touch('abc', 9999)
    expect(stored.lastActivity).toBe(9999)
  })

  it('reapIdle() returns sessions past the idle threshold and nothing else', () => {
    const store = createSessionStore(() => 'abc')
    store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch')
    store.touch('abc', 1000)
    expect(store.reapIdle(1000 + 4_000, 5_000)).toEqual([])
    expect(store.reapIdle(1000 + 6_000, 5_000).map((s) => s.id)).toEqual(['abc'])
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run voice/session-store.test.ts -v`
Expected: FAIL — `Cannot find module './session-store'`.

- [ ] **Step 3: Write `voice/session-store.ts`**

```typescript
import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { Interviewer } from './interviewer'
import type { Session } from './session'

export interface StoredSession {
  id: string
  session: Session
  interviewer: Interviewer
  startedAt: Date
  /** This session's temp directory for uploaded/transcoded audio; removed on `remove()`'s caller's cleanup. */
  scratchDir: string
  /** The open SSE response for this session, once a client has connected. */
  sseClient?: ServerResponse
  lastActivity: number
}

export interface SessionStore {
  create(session: Session, interviewer: Interviewer, startedAt: Date, scratchDir: string): StoredSession
  get(id: string): StoredSession | undefined
  remove(id: string): void
  /** True once any session is live — the web path allows exactly one at a time. */
  hasActive(): boolean
  touch(id: string, now: number): void
  /** Sessions whose lastActivity is more than idleMs behind now. Does not remove them. */
  reapIdle(now: number, idleMs: number): StoredSession[]
}

export function createSessionStore(idFactory: () => string = randomUUID): SessionStore {
  const sessions = new Map<string, StoredSession>()

  return {
    create(session, interviewer, startedAt, scratchDir) {
      const stored: StoredSession = {
        id: idFactory(),
        session,
        interviewer,
        startedAt,
        scratchDir,
        lastActivity: Date.now(),
      }
      sessions.set(stored.id, stored)
      return stored
    },
    get: (id) => sessions.get(id),
    remove: (id) => {
      sessions.delete(id)
    },
    hasActive: () => sessions.size > 0,
    touch(id, now) {
      const stored = sessions.get(id)
      if (stored) stored.lastActivity = now
    },
    reapIdle(now, idleMs) {
      return [...sessions.values()].filter((s) => now - s.lastActivity > idleMs)
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run voice/session-store.test.ts -v`
Expected: `7 passed (7)`

- [ ] **Step 5: Commit**

```bash
git add voice/session-store.ts voice/session-store.test.ts
git commit -m "feat(voice): add in-memory session store with idle reap"
```

---

### Task 5: HTTP server skeleton — 127.0.0.1 binding, static page

**Files:**
- Create: `voice/http-server.ts`
- Create: `voice/public/index.html` (minimal placeholder; full markup lands in Task 12)
- Test: `voice/http-server.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface VoiceServerDeps {
    root: string
    createTransport(): StreamFn
    transcriber: Transcriber
    idleMs?: number
  }
  export function createVoiceServer(deps: VoiceServerDeps): http.Server
  ```
  (`deps` grows in later tasks; this task only needs `root` to locate `voice/public/`.)

This task proves the server binds correctly and serves the static page, before any `/api` route exists.

- [ ] **Step 1: Write the failing test**

```typescript
// voice/http-server.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createVoiceServer } from './http-server'

let server: Server | undefined

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
})

function listen(): Promise<{ port: number }> {
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo')
      resolve({ port: address.port })
    })
  })
}

describe('createVoiceServer', () => {
  it('binds to 127.0.0.1, never 0.0.0.0', async () => {
    server = createVoiceServer({
      root: process.cwd(),
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const { port } = await listen()
    const address = server.address()
    expect(address === null || typeof address === 'string' ? null : address.address).toBe('127.0.0.1')
    void port
  })

  it('serves the page at GET /', async () => {
    server = createVoiceServer({
      root: process.cwd(),
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const { port } = await listen()
    const res = await fetch(`http://127.0.0.1:${port}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('<title>')
  })

  it('404s an unknown path', async () => {
    server = createVoiceServer({
      root: process.cwd(),
      createTransport: () => async function* () {},
      transcriber: { transcribe: async () => ({ text: '' }) },
    })
    const { port } = await listen()
    const res = await fetch(`http://127.0.0.1:${port}/nope`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run voice/http-server.test.ts -v`
Expected: FAIL — `Cannot find module './http-server'`.

- [ ] **Step 3: Write the placeholder page**

```html
<!-- voice/public/index.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Voice mock drill</title>
</head>
<body>
  <p>Placeholder — full page lands in a later task.</p>
</body>
</html>
```

- [ ] **Step 4: Write `voice/http-server.ts`**

```typescript
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { StreamFn } from './interviewer'
import type { Transcriber } from './speech'

export interface VoiceServerDeps {
  root: string
  createTransport(): StreamFn
  transcriber: Transcriber
  /** Milliseconds of inactivity before an orphaned session is reaped. Defaults to 5 minutes. */
  idleMs?: number
}

const STATIC_FILES: Record<string, { file: string; contentType: string }> = {
  '/': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', contentType: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', contentType: 'text/css; charset=utf-8' },
}

function serveStatic(deps: VoiceServerDeps, pathname: string, res: ServerResponse): boolean {
  const entry = STATIC_FILES[pathname]
  if (!entry) return false
  const full = join(deps.root, 'voice/public', entry.file)
  if (!existsSync(full)) return false
  res.writeHead(200, { 'content-type': entry.contentType })
  res.end(readFileSync(full))
  return true
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
}

export function createVoiceServer(deps: VoiceServerDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && serveStatic(deps, url.pathname, res)) return

    notFound(res)
  })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run voice/http-server.test.ts -v`
Expected: `3 passed (3)`

- [ ] **Step 6: Commit**

```bash
git add voice/http-server.ts voice/http-server.test.ts voice/public/index.html
git commit -m "feat(voice): add http server skeleton bound to 127.0.0.1"
```

---

### Task 6: `POST /api/session` — create and refuse a second concurrent session

**Files:**
- Modify: `voice/http-server.ts`
- Test: `voice/session-routes.test.ts` (new file)

**Interfaces:**
- Consumes: `buildSystemPrompt(root, 'mock')` from `voice/context.ts`; `createInterviewer(system, stream)` from `voice/interviewer.ts`; `createSession` from `voice/session.ts`; `createSessionStore` from `voice/session-store.ts`.
- Produces: `VoiceServerDeps` gains `store: SessionStore` and `now(): number` (both injectable for tests); route `POST /api/session` → `201 { id: string }` or `409 { error: string }`.

`track` is hardcoded to `'mock'` server-side — the client never sends a track or problem, since `/design` is out of scope for this plan.

- [ ] **Step 1: Write the failing test**

```typescript
// voice/session-routes.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { createSessionStore } from './session-store'

let server: Server | undefined
let root: string

function seedContext() {
  const seed = (relPath: string, body: string) => {
    const full = join(root, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  seed('.claude/commands/mock.md', 'MOCK COMMAND')
  seed('behavioral/competencies.md', '# C\n\n## Conflict\n\nbody\n')
  seed('behavioral/questions.md', 'QUESTIONS')
}

function baseDeps(overrides: Partial<VoiceServerDeps> = {}): VoiceServerDeps {
  return {
    root,
    createTransport: () => async function* () {
      yield 'Ready when you are.'
    },
    transcriber: { transcribe: async () => ({ text: '' }) },
    store: createSessionStore(() => 'session-1'),
    now: () => 0,
    ...overrides,
  }
}

function listen(deps: VoiceServerDeps): Promise<{ port: number }> {
  server = createVoiceServer(deps)
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo')
      resolve({ port: address.port })
    })
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-server-'))
  seedContext()
})

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('POST /api/session', () => {
  it('creates a session and returns its id', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'session-1' })
  })

  it('refuses a second session while one is already in progress', async () => {
    let n = 0
    const store = createSessionStore(() => `session-${++n}`)
    const { port } = await listen(baseDeps({ store }))
    const first = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(first.status).toBe(201)
    const second = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    expect(second.status).toBe(409)
    expect((await second.json()).error).toMatch(/already in progress/i)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run voice/session-routes.test.ts -v`
Expected: FAIL — `store`/`now` are not part of `VoiceServerDeps` yet, and the route doesn't exist (404 instead of 201).

- [ ] **Step 3: Modify `voice/http-server.ts`**

```typescript
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSystemPrompt } from './context'
import { createInterviewer, type StreamFn } from './interviewer'
import { createSession } from './session'
import { createSessionStore, type SessionStore } from './session-store'
import type { Transcriber } from './speech'

export interface VoiceServerDeps {
  root: string
  createTransport(): StreamFn
  transcriber: Transcriber
  store?: SessionStore
  /** Milliseconds since the epoch, injectable so tests don't depend on wall time. */
  now?(): number
  /** Milliseconds of inactivity before an orphaned session is reaped. Defaults to 5 minutes. */
  idleMs?: number
}

const STATIC_FILES: Record<string, { file: string; contentType: string }> = {
  '/': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', contentType: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', contentType: 'text/css; charset=utf-8' },
}

function serveStatic(root: string, pathname: string, res: ServerResponse): boolean {
  const entry = STATIC_FILES[pathname]
  if (!entry) return false
  const full = join(root, 'voice/public', entry.file)
  if (!existsSync(full)) return false
  res.writeHead(200, { 'content-type': entry.contentType })
  res.end(readFileSync(full))
  return true
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'not found' })
}

export function createVoiceServer(deps: VoiceServerDeps): Server {
  const store = deps.store ?? createSessionStore()
  const now = deps.now ?? Date.now

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && serveStatic(deps.root, url.pathname, res)) return

    if (req.method === 'POST' && url.pathname === '/api/session') {
      if (store.hasActive()) {
        sendJson(res, 409, { error: 'a session is already in progress' })
        return
      }
      const system = buildSystemPrompt(deps.root, 'mock')
      const interviewer = createInterviewer(system, deps.createTransport())
      const session = createSession({ interviewer, now: () => now() })
      const scratchDir = mkdtempSync(join(tmpdir(), 'voice-web-'))
      const stored = store.create(session, interviewer, new Date(), scratchDir)
      sendJson(res, 201, { id: stored.id })
      return
    }

    notFound(res)
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run voice/session-routes.test.ts -v`
Expected: `2 passed (2)`

- [ ] **Step 5: Commit**

```bash
git add voice/http-server.ts voice/session-routes.test.ts
git commit -m "feat(voice): add POST /api/session, refuse a second concurrent session"
```

---

### Task 7: `GET /api/session/:id/stream` — SSE, opening turn, disconnect auto-ends

**Files:**
- Modify: `voice/http-server.ts`
- Create: `voice/test-helpers/sse.ts`
- Test: `voice/session-routes.test.ts` (append)

**Interfaces:**
- Produces: `voice/test-helpers/sse.ts` exports `async function readSSE(response: Response): Promise<{ event: string; data: unknown }>` — reads exactly one `event:`/`data:` block off a `fetch()` response body, for repeated use across route tests.
- SSE wire format (all three event types share one connection per session):
  - `event: sentence` — `data: {"speaker":"interviewer","text":"<one speakable sentence>"}`
  - `event: entry` — `data: {"speaker":"andre"|"interviewer","text":"...","at":<ms-since-session-start>}` — emitted once per `Entry` as it is committed to the transcript (i.e. after `begin()`/`submitTurn()`'s async iterable finishes, not per-sentence).
  - `event: ended` — `data: {"endedEarly": string | null, "relPath": string | null}` — sent exactly once, after which the server ends the SSE response.

- [ ] **Step 1: Write the SSE test helper**

```typescript
// voice/test-helpers/sse.ts
export async function readSSE(response: Response): Promise<{ event: string; data: unknown }> {
  if (!response.body) throw new Error('response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (!buffer.includes('\n\n')) {
    const { value, done } = await reader.read()
    if (done) throw new Error('SSE stream ended before a full event arrived')
    buffer += decoder.decode(value, { stream: true })
  }

  const boundary = buffer.indexOf('\n\n')
  const raw = buffer.slice(0, boundary)
  reader.releaseLock()

  const lines = raw.split('\n')
  const eventLine = lines.find((l) => l.startsWith('event:'))
  const dataLine = lines.find((l) => l.startsWith('data:'))
  if (!eventLine || !dataLine) throw new Error(`malformed SSE block: ${raw}`)

  return { event: eventLine.slice('event:'.length).trim(), data: JSON.parse(dataLine.slice('data:'.length).trim()) }
}
```

- [ ] **Step 2: Write the failing test**

Append to `voice/session-routes.test.ts`:

```typescript
import { readSSE } from './test-helpers/sse'

describe('GET /api/session/:id/stream', () => {
  it('streams the opening turn as sentence events, then an entry event', async () => {
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* () {
          yield 'What are we '
          yield 'optimising for?'
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = await created.json()

    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')

    const first = await readSSE(stream)
    expect(first).toEqual({ event: 'sentence', data: { speaker: 'interviewer', text: 'What are we optimising for?' } })

    const second = await readSSE(stream)
    expect(second.event).toBe('entry')
    expect(second.data).toMatchObject({ speaker: 'interviewer', text: 'What are we optimising for?' })
  })

  it('404s an unknown session id', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session/nope/stream`)
    expect(res.status).toBe(404)
  })

  it('a client disconnecting ends and persists the session', async () => {
    const { port } = await listen(baseDeps())
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = await created.json()

    const controller = new AbortController()
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`, { signal: controller.signal })
    await readSSE(stream) // the opening sentence event, so the server has definitely started the turn
    controller.abort()

    // Give the server's 'close' handler a tick to run and persist.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const relPath = join(root, 'local/mock-' + new Date().toISOString().slice(0, 10) + '.md')
    expect(existsSync(relPath)).toBe(true)
  })
})
```

Add `import { existsSync } from 'node:fs'` to the top of `voice/session-routes.test.ts` alongside the other `node:fs` imports.

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm vitest run voice/session-routes.test.ts -v`
Expected: FAIL — the `GET .../stream` route doesn't exist yet (404 for all three new tests, including the one that already expects 404, so watch for that one accidentally passing for the wrong reason — confirm the other two fail).

- [ ] **Step 4: Modify `voice/http-server.ts`** — add the stream route and its helpers

Add these imports and this route inside the request handler, and the two helper functions below it:

```typescript
import { finishSession } from './session'
```

Add `root: string` to `VoiceServerDeps` usage already present; add a helper above `createVoiceServer`:

```typescript
function writeSSE(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function streamTurn(res: ServerResponse, turn: AsyncIterable<string>): Promise<void> {
  for await (const sentence of turn) {
    writeSSE(res, 'sentence', { speaker: 'interviewer', text: sentence })
  }
}

function endAndPersist(deps: VoiceServerDeps, store: SessionStore, id: string): void {
  const stored = store.get(id)
  if (!stored) return
  const { relPath } = finishSession(stored.session, stored.interviewer, {
    root: deps.root,
    track: 'mock',
    startedAt: stored.startedAt,
  })
  if (stored.sseClient) {
    writeSSE(stored.sseClient, 'ended', { endedEarly: stored.session.endedEarly() ?? null, relPath })
    stored.sseClient.end()
  }
  store.remove(id)
}
```

Add the route, inside `createServer`'s handler, after the `POST /api/session` block:

```typescript
    const streamMatch = /^\/api\/session\/([^/]+)\/stream$/.exec(url.pathname)
    if (req.method === 'GET' && streamMatch) {
      const id = streamMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      stored.sseClient = res

      req.on('close', () => {
        endAndPersist(deps, store, id)
      })

      const alreadyBegun = stored.session.entries().length > 0
      if (!alreadyBegun) {
        void (async () => {
          const before = stored.session.entries().length
          await streamTurn(res, stored.session.begin())
          for (const entry of stored.session.entries().slice(before)) {
            writeSSE(res, 'entry', entry)
          }
          if (stored.session.endedEarly()) endAndPersist(deps, store, id)
        })()
      }
      return
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run voice/session-routes.test.ts -v`
Expected: `5 passed (5)`

- [ ] **Step 6: Commit**

```bash
git add voice/http-server.ts voice/test-helpers/sse.ts voice/session-routes.test.ts
git commit -m "feat(voice): add SSE stream route, disconnect auto-ends the session"
```

---

### Task 8: `POST /api/session/:id/turn` — upload, transcode, transcribe, submit

**Files:**
- Modify: `voice/http-server.ts`
- Test: `voice/session-routes.test.ts` (append)

**Interfaces:**
- Consumes: `transcodeToWav` from Task 3.
- Produces: `VoiceServerDeps` gains `transcode?: typeof transcodeToWav` (injectable so tests never spawn real ffmpeg); route `POST /api/session/:id/turn` accepts the raw audio bytes as the request body (whatever `Content-Type` the browser's `MediaRecorder` produced — the server does not parse it, it hands the bytes straight to `ffmpeg`, which detects the container itself). Responds `202 { text: string }` on success, `422 { error: string }` on a transcode/transcribe failure, `404` for an unknown id, `409` if the session already ended.

No multipart parsing is needed or added: the browser sends the recorded `Blob` directly as the POST body (`fetch(url, { method: 'POST', body: blob })`), so the server just reads the raw stream.

- [ ] **Step 1: Write the failing test**

Append to `voice/session-routes.test.ts`:

```typescript
describe('POST /api/session/:id/turn', () => {
  it('transcodes, transcribes, and streams the interviewer reply to the open SSE connection', async () => {
    const { port } = await listen(
      baseDeps({
        createTransport: () => async function* () {
          yield 'Tell me more.'
        },
        transcriber: { transcribe: async () => ({ text: 'I would shard by tenant.' }) },
        transcode: async (_input, output) => {
          writeFileSync(output, Buffer.from('fake wav bytes'))
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = await created.json()
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(stream) // opening sentence
    await readSSE(stream) // opening entry

    const turnRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'audio/webm' },
      body: Buffer.from('fake webm bytes'),
    })
    expect(turnRes.status).toBe(202)
    expect(await turnRes.json()).toEqual({ text: 'I would shard by tenant.' })

    const andreEntry = await readSSE(stream)
    expect(andreEntry).toEqual({ event: 'entry', data: { speaker: 'andre', text: 'I would shard by tenant.', at: 0 } })

    const replySentence = await readSSE(stream)
    expect(replySentence).toEqual({ event: 'sentence', data: { speaker: 'interviewer', text: 'Tell me more.' } })
  })

  it('ends the session on a transcode failure and reports it over SSE', async () => {
    const { port } = await listen(
      baseDeps({
        transcode: async () => {
          throw new Error('ffmpeg: invalid data found')
        },
      }),
    )
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = await created.json()
    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    await readSSE(stream)
    await readSSE(stream)

    const turnRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('garbage'),
    })
    expect(turnRes.status).toBe(422)

    const ended = await readSSE(stream)
    expect(ended.event).toBe('ended')
    expect((ended.data as { endedEarly: string | null }).endedEarly).toMatch(/ffmpeg/i)
  })

  it('404s an unknown session id', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session/nope/turn`, { method: 'POST', body: Buffer.from('x') })
    expect(res.status).toBe(404)
  })
})
```

Add `import { writeFileSync } from 'node:fs'` if not already imported at the top of the file (it already is, via `seedContext`'s helper — confirm and reuse the existing import).

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run voice/session-routes.test.ts -v`
Expected: FAIL — the `/turn` route doesn't exist (404 for the two tests that expect 202/422).

- [ ] **Step 3: Modify `voice/http-server.ts`**

Add to `VoiceServerDeps`:

```typescript
  /** Injectable so tests never spawn a real ffmpeg process. */
  transcode?(inputPath: string, outputPath: string): Promise<void>
```

Add the import:

```typescript
import { transcodeToWav } from './transcode'
import { writeFile } from 'node:fs/promises'
```

Inside `createVoiceServer`, after resolving `store`/`now`, resolve the transcoder:

```typescript
  const transcode = deps.transcode ?? transcodeToWav
```

Add the route after the stream route:

```typescript
    const turnMatch = /^\/api\/session\/([^/]+)\/turn$/.exec(url.pathname)
    if (req.method === 'POST' && turnMatch) {
      const id = turnMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }
      if (stored.session.endedEarly()) {
        sendJson(res, 409, { error: 'session already ended' })
        return
      }
      store.touch(id, now())

      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const audio = Buffer.concat(chunks)

      const inputPath = join(stored.scratchDir, `turn-${Date.now()}.webm`)
      const outputPath = join(stored.scratchDir, `turn-${Date.now()}.wav`)
      await writeFile(inputPath, audio)

      let text: string
      try {
        await transcode(inputPath, outputPath)
        text = (await deps.transcriber.transcribe(outputPath)).text
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        stored.session.reportFailure(message)
        sendJson(res, 422, { error: message })
        endAndPersist(deps, store, id)
        return
      }

      sendJson(res, 202, { text })

      void (async () => {
        const before = stored.session.entries().length
        await streamTurn(res, stored.session.submitTurn(text))
        if (stored.sseClient) {
          for (const entry of stored.session.entries().slice(before)) {
            writeSSE(stored.sseClient, 'entry', entry)
          }
        }
        if (stored.session.endedEarly()) endAndPersist(deps, store, id)
      })()
      return
    }
```

Note the second `void (async () => {...})()` writes SSE events to `stored.sseClient`, not to `res` (the `POST /turn` response, which has already ended) — fix `streamTurn`'s call site to pass `stored.sseClient!` instead of `res`:

```typescript
        await streamTurn(stored.sseClient!, stored.session.submitTurn(text))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run voice/session-routes.test.ts -v`
Expected: `8 passed (8)`

- [ ] **Step 5: Commit**

```bash
git add voice/http-server.ts voice/session-routes.test.ts
git commit -m "feat(voice): add POST /turn — transcode, transcribe, stream the reply"
```

---

### Task 9: `POST /api/session/:id/end` and idle-timeout reap

**Files:**
- Modify: `voice/http-server.ts`
- Test: `voice/session-routes.test.ts` (append)

**Interfaces:**
- Produces: route `POST /api/session/:id/end` → `200 { relPath: string, storyLogWritten: boolean }`; a periodic sweep (using `deps.idleMs`, default 5 minutes) that reaps and persists sessions the same way a disconnect does.

- [ ] **Step 1: Write the failing test**

Append to `voice/session-routes.test.ts`:

```typescript
describe('POST /api/session/:id/end', () => {
  it('persists the transcript and reports the path', async () => {
    const { port } = await listen(baseDeps())
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = await created.json()

    const res = await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.relPath).toMatch(/^local\/mock-\d{4}-\d{2}-\d{2}\.md$/)
    expect(existsSync(join(root, body.relPath))).toBe(true)
  })

  it('404s an unknown session id', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session/nope/end`, { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('a second /end on the same id 404s — the session is already gone', async () => {
    const { port } = await listen(baseDeps())
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = await created.json()
    await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    const res = await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

describe('idle reap', () => {
  it('reaps and persists a session nobody has touched within idleMs', async () => {
    let clock = 0
    const { port } = await listen(baseDeps({ now: () => clock, idleMs: 1000 }))
    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    const { id } = await created.json()

    clock = 5000
    // The sweep runs on its own interval; poll briefly for the file to appear
    // rather than asserting on internal timer state.
    const deadline = Date.now() + 2000
    let found = false
    while (Date.now() < deadline) {
      const files = existsSync(join(root, 'local'))
      if (files) {
        found = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(found).toBe(true)
    void id
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run voice/session-routes.test.ts -v`
Expected: FAIL — `/end` doesn't exist (404 vs 200), and nothing reaps idle sessions yet.

- [ ] **Step 3: Modify `voice/http-server.ts`**

Add the `/end` route after the `/turn` route:

```typescript
    const endMatch = /^\/api\/session\/([^/]+)\/end$/.exec(url.pathname)
    if (req.method === 'POST' && endMatch) {
      const id = endMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }
      const { relPath, storyLogWritten } = finishSession(stored.session, stored.interviewer, {
        root: deps.root,
        track: 'mock',
        startedAt: stored.startedAt,
      })
      if (stored.sseClient) {
        writeSSE(stored.sseClient, 'ended', { endedEarly: stored.session.endedEarly() ?? null, relPath })
        stored.sseClient.end()
      }
      store.remove(id)
      sendJson(res, 200, { relPath, storyLogWritten })
      return
    }
```

Remove the now-duplicated persistence logic from `endAndPersist` in favour of it being the single implementation both this route and the disconnect/idle paths call — `endAndPersist` already does exactly this, so leave `/end`'s handler as its own inline block (it additionally needs `storyLogWritten` in its response, which `endAndPersist` doesn't return) and leave `endAndPersist` for the two paths that don't need to respond to an HTTP caller.

Add the idle sweep. In `createVoiceServer`, before the `return createServer(...)`:

```typescript
  const idleMs = deps.idleMs ?? 5 * 60_000
  const sweep = setInterval(() => {
    for (const stored of store.reapIdle(now(), idleMs)) {
      endAndPersist(deps, store, stored.id)
    }
  }, Math.min(idleMs, 30_000))
  sweep.unref()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run voice/session-routes.test.ts -v`
Expected: `12 passed (12)`

- [ ] **Step 5: Commit**

```bash
git add voice/http-server.ts voice/session-routes.test.ts
git commit -m "feat(voice): add POST /end and idle-timeout reap for orphaned sessions"
```

---

### Task 10: The spoiler-gate teeth test

**Files:**
- Create: `voice/spoiler-gate.test.ts`

**Interfaces:**
- Consumes: `createVoiceServer` from Task 9's finished `http-server.ts`.

This is the test the spec calls out by name: it must be provably capable of failing. Every route's response bytes — JSON bodies and SSE payloads alike — are swept for content from denied files (`patterns.md`, `solutions/**`, `reference.md`) and for the raw, unstripped `story-log` trailer that `interviewer.lastRaw()` carries. The proof is in Step 4: a deliberate one-line leak is added to the server, the test is confirmed red, and the leak is reverted before commit.

- [ ] **Step 1: Write the test**

```typescript
// voice/spoiler-gate.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { createSessionStore } from './session-store'
import { readSSE } from './test-helpers/sse'

let server: Server | undefined
let root: string

const DENIED_STRING = 'THE ANSWER — reference.md body'
const TRAILER = '```story-log\ncompetency: Conflict\nstory: The migration\nworked: Owned the timeline\nfix: Name the tradeoff sooner\n```'

function seed() {
  const seedFile = (relPath: string, body: string) => {
    const full = join(root, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  seedFile('.claude/commands/mock.md', 'MOCK COMMAND')
  seedFile('behavioral/competencies.md', '# C\n\n## Conflict\n\nbody\n')
  seedFile('behavioral/questions.md', 'QUESTIONS')
  // A denied file present in the checkout, exactly as it would be in the real repo.
  seedFile('patterns.md', DENIED_STRING)
}

function listen(deps: VoiceServerDeps): Promise<{ port: number }> {
  server = createVoiceServer(deps)
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo')
      resolve({ port: address.port })
    })
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-spoiler-'))
  seed()
})

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('spoiler gate', () => {
  it('no response body, from any route, ever contains denied-file content or the raw trailer', async () => {
    const { port } = await listen({
      root,
      createTransport: () => async function* () {
        yield `Good critique. ${TRAILER}`
      },
      transcriber: { transcribe: async () => ({ text: 'A story about a migration.' }) },
      store: createSessionStore(() => 'session-1'),
      now: () => 0,
    })

    const responses: string[] = []

    const created = await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST' })
    responses.push(await created.clone().text())
    const { id } = await created.json()

    const stream = await fetch(`http://127.0.0.1:${port}/api/session/${id}/stream`)
    responses.push(JSON.stringify(await readSSE(stream)))
    responses.push(JSON.stringify(await readSSE(stream)))

    const turnRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/turn`, {
      method: 'POST',
      body: Buffer.from('audio'),
    })
    responses.push(await turnRes.clone().text())
    responses.push(JSON.stringify(await readSSE(stream))) // andre entry
    responses.push(JSON.stringify(await readSSE(stream))) // interviewer sentence — trailer must be stripped here

    const endRes = await fetch(`http://127.0.0.1:${port}/api/session/${id}/end`, { method: 'POST' })
    responses.push(await endRes.clone().text())

    for (const body of responses) {
      expect(body).not.toContain(DENIED_STRING)
      expect(body).not.toContain('story-log')
      expect(body).not.toContain('competency: Conflict')
    }
  })
})
```

Note: this test needs `voice/http-server.ts`'s `deps.transcode` to succeed without a real ffmpeg — since the default `transcode` is `transcodeToWav`, add `transcode: async (_input: string, output: string) => writeFileSync(output, Buffer.from('fake wav'))` to the `listen()` call's deps object (both here and confirm the same pattern is already used in Task 8's tests). Add that field to the object literal above before running.

- [ ] **Step 2: Run it to confirm it passes as written**

Run: `pnpm vitest run voice/spoiler-gate.test.ts -v`
Expected: `1 passed (1)` — this is the baseline: the gate holds today.

- [ ] **Step 3: Prove the test has teeth — introduce a deliberate leak**

Temporarily edit `voice/http-server.ts`'s `POST /api/session` handler to leak the assembled prompt in a debug field, exactly the failure mode named in the spec:

```typescript
      const system = buildSystemPrompt(deps.root, 'mock')
      // TEMPORARY — for the spoiler-gate falsification step only.
      sendJson(res, 201, { id: 'debug', debugSystemPrompt: system })
```

(Comment out the two real lines below it — `const interviewer = ...` through `sendJson(res, 201, { id: stored.id })` — for this step only, since the handler can't fall through to both.)

- [ ] **Step 4: Run the test again and confirm it goes red**

Run: `pnpm vitest run voice/spoiler-gate.test.ts -v`
Expected: FAIL — the response body from `POST /api/session` now contains `DENIED_STRING` (patterns.md's body, injected into the system prompt via `buildSystemPrompt`... actually `mock`'s allowlist doesn't include `patterns.md`, so confirm the leak surfaces via a denied string that mock's prompt *would* carry if the allowlist were mistakenly widened — see note below).

**Note on the falsification payload:** `buildSystemPrompt(root, 'mock')` does not read `patterns.md` even with the leak in place — `allowedPaths('mock')` never names it, so `DENIED_STRING` will *not* appear via this particular leak. To make the falsification faithful, seed the leak into a file `mock`'s prompt *does* legitimately assemble instead — assert on a substring of `MOCK COMMAND` or `Conflict` being present in the leaked `debugSystemPrompt` field, i.e. broaden the test's assertion for this step to also check `expect(body).not.toContain('MOCK COMMAND')`. Confirm this alternate assertion goes red with the leak in place (the debug field now contains `MOCK COMMAND`), proving the test can fail on prompt-content leakage in general, not only on `patterns.md` specifically.

- [ ] **Step 5: Revert the leak**

```bash
git diff voice/http-server.ts
git checkout -- voice/http-server.ts
```

Confirm the file matches Task 9's committed state (`git diff` empty).

- [ ] **Step 6: Run the test one final time to confirm it's back to green**

Run: `pnpm vitest run voice/spoiler-gate.test.ts -v`
Expected: `1 passed (1)`

- [ ] **Step 7: Commit**

```bash
git add voice/spoiler-gate.test.ts
git commit -m "test(voice): add spoiler-gate sweep across every route response"
```

---

### Task 11: Harden the `track`/`problem` HTTP boundary

**Files:**
- Modify: `voice/http-server.ts`
- Test: `voice/session-routes.test.ts` (append)

**Interfaces:**
- No new exports. `POST /api/session` already hardcodes `'mock'` server-side (Task 6) and never reads a client-supplied `track` or `problem` field — this task makes that explicit and adversarial-tested, since the groundwork survey flags this exact boundary as the place "it's just Andre typing" reasoning stops applying.

Because this plan's scope is `/mock` only, `context.ts`'s `PROBLEM_SLUG`/traversal checks (which guard the `design` track's `problem` parameter) are never exercised by this server at all — there is no code path that passes a client-supplied string into `allowedPaths`. The judgement call here is to prove that directly: any `track`/`problem` field the client sends is ignored, not merely "happens to be safe because nothing reads it yet."

- [ ] **Step 1: Write the failing test**

Append to `voice/session-routes.test.ts`:

```typescript
describe('the track/problem boundary', () => {
  it.each([
    { track: 'design', problem: 'rate-limiter' },
    { track: 'design', problem: '../../solutions/elimination/celebrity' },
    { track: 'mock', problem: '/etc/passwd' },
    { track: 'mock', problem: 'patterns.md' },
  ])('ignores a client-supplied track/problem and always builds the mock prompt: %j', async (payload) => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(res.status).toBe(201)
    const { id } = await res.json()
    expect(id).toBe('session-1')
    // No 500, no path-traversal error surfaced — the body is simply never read.
  })
})
```

- [ ] **Step 2: Run it to confirm it fails or passes for the wrong reason**

Run: `pnpm vitest run voice/session-routes.test.ts -v`
Expected: today's handler already ignores the request body entirely (it never calls anything that reads `req` beyond routing), so this should already pass. Confirm that by running it — if it fails, the earlier tasks read something from the body they should not, and that must be fixed before continuing.

- [ ] **Step 3: Make the boundary explicit in code**

`voice/http-server.ts`'s `POST /api/session` handler already never parses a request body. Add a one-line comment making the invariant explicit, so a future change to accept a body doesn't silently reopen this:

```typescript
    if (req.method === 'POST' && url.pathname === '/api/session') {
      // Deliberately does not read the request body: the design track is out
      // of scope, so there is no client-supplied `track` or `problem` for
      // this boundary to validate. If `/design` is ever added here,
      // `context.ts`'s `PROBLEM_SLUG` and `assertNoSpoilers` must run on
      // whatever arrives in the body before it reaches `buildSystemPrompt`.
      if (store.hasActive()) {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run voice/session-routes.test.ts -v`
Expected: `16 passed (16)`

- [ ] **Step 5: Commit**

```bash
git add voice/http-server.ts voice/session-routes.test.ts
git commit -m "test(voice): prove the server ignores client-supplied track/problem"
```

---

### Task 12: The client — record button, transcript, speech

**Files:**
- Modify: `voice/public/index.html` (replace the Task 5 placeholder)
- Create: `voice/public/app.js`
- Create: `voice/public/style.css`

**Interfaces:**
- Consumes the SSE wire format from Task 7 (`sentence`, `entry`, `ended` events) and the REST responses from Tasks 6, 8, 9 (`POST /api/session` → `{id}`, `POST /turn` → `{text}`, `POST /end` → `{relPath, storyLogWritten}`).

No automated test: `MediaRecorder` and `SpeechSynthesis` are browser/third-party implementations behind no interface this repo owns, matching the spec's explicit "deliberately not tested" list. This task ends in a manual run (Step 4), not a `vitest` gate — that is not a plan defect, it is what the spec calls for.

- [ ] **Step 1: Write `voice/public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Voice mock drill</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <h1>Voice mock drill</h1>
  <p id="status">Idle.</p>
  <button id="record">Start session</button>
  <ol id="transcript"></ol>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `voice/public/app.js`**

```javascript
const statusEl = document.getElementById('status')
const buttonEl = document.getElementById('record')
const transcriptEl = document.getElementById('transcript')

let sessionId = null
let eventSource = null
let mediaRecorder = null
let recordedChunks = []
let mode = 'idle' // idle | listening-to-interviewer | recording | ended

function setStatus(text) {
  statusEl.textContent = text
}

// Renders only Entry-shaped data delivered over SSE — never a debug field,
// never `lastRaw()`. This is the client half of the spoiler gate: even if a
// route ever leaked something extra, this renderer has no code path that
// would display it, because it only reads `speaker`/`text`/`at`.
function appendEntry(entry) {
  const li = document.createElement('li')
  li.textContent = `${entry.speaker === 'andre' ? 'You' : 'Interviewer'}: ${entry.text}`
  transcriptEl.appendChild(li)
}

function speak(text) {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onend = resolve
    utterance.onerror = resolve
    window.speechSynthesis.speak(utterance)
  })
}

async function connectStream(id) {
  eventSource = new EventSource(`/api/session/${id}/stream`)

  eventSource.addEventListener('sentence', async (event) => {
    const { text } = JSON.parse(event.data)
    setStatus('Interviewer speaking…')
    await speak(text)
  })

  eventSource.addEventListener('entry', (event) => {
    appendEntry(JSON.parse(event.data))
  })

  eventSource.addEventListener('ended', (event) => {
    const { endedEarly } = JSON.parse(event.data)
    setStatus(endedEarly ? `Session ended early: ${endedEarly}` : 'Session ended.')
    eventSource.close()
    buttonEl.textContent = 'Start session'
    mode = 'ended'
  })
}

async function startSession() {
  const res = await fetch('/api/session', { method: 'POST' })
  if (res.status === 409) {
    setStatus('A session is already in progress.')
    return
  }
  const { id } = await res.json()
  sessionId = id
  transcriptEl.innerHTML = ''
  await connectStream(id)
  mode = 'listening-to-interviewer'
  buttonEl.textContent = 'Record your answer'
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  recordedChunks = []
  mediaRecorder = new MediaRecorder(stream)
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data)
  }
  mediaRecorder.start()
  mode = 'recording'
  buttonEl.textContent = 'Done — send turn'
  setStatus('Recording. Press the button when you are done.')
}

async function stopRecordingAndSubmit() {
  const stopped = new Promise((resolve) => {
    mediaRecorder.onstop = resolve
  })
  mediaRecorder.stop()
  await stopped
  for (const track of mediaRecorder.stream.getTracks()) track.stop()

  const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType })
  setStatus('Transcribing…')
  const res = await fetch(`/api/session/${sessionId}/turn`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'application/octet-stream' },
    body: blob,
  })
  if (res.status === 422) {
    const { error } = await res.json()
    setStatus(`Turn failed: ${error}`)
    mode = 'ended'
    return
  }
  mode = 'listening-to-interviewer'
  buttonEl.textContent = 'Record your answer'
}

async function endSession() {
  await fetch(`/api/session/${sessionId}/end`, { method: 'POST' })
}

buttonEl.addEventListener('click', async () => {
  if (mode === 'idle' || mode === 'ended') {
    await startSession()
  } else if (mode === 'listening-to-interviewer') {
    await startRecording()
  } else if (mode === 'recording') {
    await stopRecordingAndSubmit()
  }
})

window.addEventListener('beforeunload', () => {
  if (sessionId && mode !== 'ended') {
    // Best-effort — the SSE disconnect handler on the server is the real
    // guarantee that an abandoned tab still gets persisted.
    navigator.sendBeacon(`/api/session/${sessionId}/end`)
  }
})
```

- [ ] **Step 3: Write `voice/public/style.css`**

```css
body {
  font-family: system-ui, sans-serif;
  max-width: 40rem;
  margin: 2rem auto;
  padding: 0 1rem;
}

#status {
  color: #555;
  min-height: 1.5rem;
}

#record {
  font-size: 1.1rem;
  padding: 0.6rem 1.2rem;
  cursor: pointer;
}

#transcript {
  list-style: none;
  padding: 0;
  margin-top: 1.5rem;
}

#transcript li {
  padding: 0.5rem 0;
  border-bottom: 1px solid #ddd;
}
```

- [ ] **Step 4: Manual run**

Run: `pnpm mock:web` (added in Task 13), open `http://127.0.0.1:<port>/` in a real browser, click through one full turn: start session, hear the opening line, record a short answer, confirm the transcript renders both sides, click through to end. This is the one non-automated check the spec calls for — do not claim the client works from the route tests alone.

- [ ] **Step 5: Commit**

```bash
git add voice/public/index.html voice/public/app.js voice/public/style.css
git commit -m "feat(voice): add the web client — record, stream, speak, render"
```

---

### Task 13: Wire up the script, run full regression gates

**Files:**
- Modify: `package.json`
- Modify: `voice/http-server.ts` (add the `main()` entrypoint)

**Interfaces:**
- Produces: `pnpm mock:web` — starts the server bound to `127.0.0.1` on a fixed or `PORT`-overridable port, wiring the same transport choice `cli.ts` uses (`ANTHROPIC_API_KEY` present → `anthropicStream`, else `claudeCliStream`) and the same `whisperTranscriber` config.

- [ ] **Step 1: Add `main()` to `voice/http-server.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { anthropicStream } from './interviewer'
import { claudeCliStream } from './claude-cli'
import { whisperTranscriber } from './speech'

const WHISPER_BINARY = process.env.WHISPER_BINARY ?? 'whisper-cli'
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? 'models/ggml-large-v3-turbo.bin'

function chooseTransport(): StreamFn {
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('Transport: Anthropic Messages API (spending Console credits)')
    return anthropicStream(new Anthropic())
  }
  console.log('Transport: claude CLI (spending Claude subscription quota)')
  return claudeCliStream()
}

function main(): void {
  const port = process.env.PORT ? Number(process.env.PORT) : 4173
  const server = createVoiceServer({
    root: process.cwd(),
    createTransport: chooseTransport,
    transcriber: whisperTranscriber({ binary: WHISPER_BINARY, model: WHISPER_MODEL }),
  })
  server.listen(port, '127.0.0.1', () => {
    console.log(`Voice mock drill: http://127.0.0.1:${port}/`)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
```

- [ ] **Step 2: Add the script to `package.json`**

```json
    "mock:web": "tsx voice/http-server.ts"
```

(Add this line alongside the existing `"mock:voice"` entry in the `scripts` block.)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Run the full voice suite**

Run: `pnpm vitest run voice/`
Expected: all voice test files pass — 9 pre-existing files plus `transcode.test.ts`, `session-store.test.ts`, `http-server.test.ts`, `session-routes.test.ts`, `spoiler-gate.test.ts` (14 files total), 0 failures.

- [ ] **Step 5: Confirm the full-repo failed-file count is unchanged**

Run: `pnpm test 2>&1 | tail -5`
Expected: `Test Files  28 failed | <N+14> passed`, where `<N>` was the passed-file count before this plan started (15, confirmed during planning) — i.e. exactly 28 failed files, same as before this plan touched anything. If the failed count differs from 28, something outside `voice/` broke; stop and investigate before committing.

- [ ] **Step 6: Manual smoke test of the terminal path**

Run: `pnpm mock:voice` for a few seconds, confirm it still starts, prints the device warning, and accepts `end` to exit cleanly — this is the plan's final proof that the terminal path was not disturbed by anything in Tasks 1–12.

- [ ] **Step 7: Commit**

```bash
git add package.json voice/http-server.ts
git commit -m "feat(voice): wire up pnpm mock:web"
```

---

## Self-Review

**Spec coverage:**
- Zero new dependencies — confirmed; every task uses only `node:*` builtins plus existing `voice/` modules.
- The `Session` refactor, `runSession` preserved, `session.test.ts` untouched — Task 1.
- Five routes, `127.0.0.1` binding — Tasks 5–9, with a binding test in Task 5.
- SSE wire format spelled out concretely — Task 7's Interfaces block, used by both server (Tasks 7–9) and client (Task 12).
- Audio: browser blob without a multipart library, exact ffmpeg invocation — Task 3 (`ffmpegTranscodeArgs`) and Task 8 (raw-body read via `for await (const chunk of req)`).
- Spoiler gate's three rules — rule 1 (prompt never in a response) gets the teeth test in Task 10 with its falsification step; rule 2 (`lastRaw()` never crosses the wire) is asserted in the same test (the raw trailer is swept for) and structurally enforced by the client only rendering `entry`/`sentence` SSE payloads (Task 12); rule 3 (`problem`/`track` validated at the boundary) is Task 11, scoped down to "ignored entirely" since `/design` is out of scope.
- `competencyCoverage`'s server-side-only heading parse — untouched, `context.ts` is never modified by this plan.
- Failure modes (turn fails, tab closes, orphaned session, second session refused) — Task 8 (turn failure), Task 7 (disconnect), Task 9 (idle reap + refusal already in Task 6).
- Testing section's explicit exclusions (`MediaRecorder`, `SpeechSynthesis`, whisper accuracy, ffmpeg fidelity) — honored in Tasks 3 and 12, stated explicitly rather than silently skipped.
- Commands and gates — Task 13's Steps 3–6 give exact commands and expected output, including the 28-failed-file invariant.

**Placeholder scan:** No task step reads "add appropriate error handling," "TBD," or "similar to Task N" — every step that changes code shows the code in full. Task 10's Step 4 has one place that reads like an open question in prose ("Note on the falsification payload") — this is deliberate: it documents a genuine subtlety about which denied string actually appears in the leak (the plan explains exactly why and gives the corrected assertion), not a placeholder for missing work.

**Type consistency:** `Session`, `CreateSessionOptions`, `FinishOptions`, `FinishResult` (Task 1) are used with identical field names throughout Tasks 2, 6–9. `VoiceServerDeps` accumulates fields additively across Tasks 5, 6, 8, 9, 13 — each task's diff to the interface is explicit rather than assumed. `StoredSession`/`SessionStore` (Task 4) field names (`sseClient`, `scratchDir`, `lastActivity`) match their use in Tasks 6–9 exactly.

**Judgement calls made, flagged for the record:**
1. **`Session` gained a fifth member, `begin()`, beyond the spec's four-row table.** The spec's table is illustrative, not exhaustive; `begin()` keeps the opening turn (which records no Andre entry) from needing a sentinel-string special case inside `submitTurn()`, and keeps `entries()` a pure accessor no caller mutates.
2. **`Session` also gained `reportFailure()`**, for the pre-transcription failure case (an uploaded turn's transcode or transcription itself fails, so there is no `said` text to hand to `submitTurn()`). This mirrors the CLI's existing `recording failed`/`transcription failed` branches, which never had transcribed text either.
3. **`finishSession()` is a standalone function, not a `Session` method**, taking the `Interviewer` alongside the `Session`. `cli.ts` is left completely unmodified and keeps calling `transcript.ts` directly exactly as it does today; only `http-server.ts` calls `finishSession()`. This was chosen over adding `end()` to the `Session` interface itself specifically to avoid threading `root`/`track`/`problem`/`startedAt` into every `Session`, including the CLI's, which never needs them.
4. **Task 11 narrows "`problem` validated at the boundary" to "ignored entirely."** Because scope is `/mock` only and `/design` is deferred, no code path in this plan ever passes a client-supplied string into `allowedPaths()`/`PROBLEM_SLUG`. The task proves the absence of the risk (the body is never parsed) rather than adding validation to a parameter this server doesn't accept — validation would be exercised code with nothing to validate.
5. **The SSE stream is one persistent connection per session**, reused across every turn (opening plus all subsequent), rather than one connection per turn. This was the natural reading of "`GET /api/session/:id/stream`" being singular in the spec's route table, and it is what makes the disconnect-auto-ends behaviour (Task 7) meaningful — a per-turn connection would have no session-lifetime signal to listen for.
