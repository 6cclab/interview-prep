import { deriveUserId } from './identity'
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { mkdtempSync, existsSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertNoSpoilers,
  buildSystemPrompt,
  CLARIFY_FIRST_BRIEF,
  closingCue,
  hintCue,
  timeCue,
  CODING_BUDGET_MS,
  DEBUG_BUDGET_MS,
  DEBUG_HINT_RUNGS,
  DESIGN_BUDGET_MS,
  MAX_SERVABLE_DEBUG_RUNG,
  debugHintCue,
  MAX_HINT_RUNG,
  PROBLEM_SLUG,
  type Track,
} from './context'
import { findCodingProblem, listCodingProblems, problemDir } from './problems'
import { readSolution, writeSolution, versionOf } from './solution-file'
import { findCompetency, listCompetencies } from './competencies'
import { findExercise, listExercises } from './exercises'
import { runDebugTests, debugVerdictCue, type DebugVerdict } from './debug-tests'
import { buildCoachPrompt, codeCue, readWorkingFile } from './coach'
import { appendCoached, isoDate, readCoachedProblems } from './coached'
import { runDrillTests, verdictCue } from './drill-tests'
import { createInterviewer, type StreamFn } from './interviewer'
import { backendSummary, describeBackend, modelFor, streamForBackend, transportLabel } from './backend'
import { preloadOllama } from './ollama'
import { createSession, finishSession, type FinishResult } from './session'
import { createSessionStore, type Drill, type RetainedAudio, type SessionStore, type StoredSession } from './session-store'
import {
  checkSpeechEngine,
  resolveSpeaker,
  whisperTranscriber,
  type SayOptions,
  type Speaker,
  type Transcriber,
} from './speech'
import { openDisabled, openInBrowser, openPlan } from './open-browser'
import { readDrillLog, summarise } from './drill-log'
import { transcriptionPrompt } from './vocabulary'
import { transcodeToWav } from './transcode'
import { readStaticFile, resolveStaticFile } from './static'
import {
  listOutputDevices,
  readDeviceConfig,
  resolveSpeech,
  writeDeviceConfig,
  type Device,
  type DeviceConfig,
} from './devices'

export interface VoiceServerDeps {
  root: string
  /**
   * Which instance this is. Defaults to `local`, so every existing caller and
   * every existing test keeps today's behaviour without saying anything.
   *
   * `deployed` is a different mode rather than a loosened local one: identity
   * is required, state is per user, and the coach track is gated. Local stays
   * exactly as it is — one person, one session, `local/`, no headers read.
   */
  mode?: 'local' | 'deployed'
  /**
   * A secret only the edge can set, checked in constant time.
   *
   * Traefik's forwardAuth does not strip a client-supplied `X-authentik-*`
   * header of its own accord, so the middleware chain has to clear them before
   * the outpost repopulates them. This is the backstop for the day that chain
   * is edited wrong: without it, one misordered middleware makes identity
   * forgeable by anyone who can reach the port.
   */
  gatewaySecret?: string
  /**
   * Who may open the coach track on a deployed instance. Undefined means
   * unrestricted, which is what a local instance wants.
   *
   * `coachPaths` deliberately serves `solutions/**` and `patterns.md`. That is
   * right for a choice you make about your own drilling and wrong the moment
   * the same route has a URL other people can reach, where it is an answer key.
   * An allowlist is another explicit door, not the existing door with its lock
   * off — see `voice/coach.ts` on why conditional safety gates leak.
   */
  coachAllowlist?: ReadonlySet<string>
  /**
   * The interviewer transport for a session on `track`.
   *
   * Takes the track because the backend is chosen per track — see
   * `voice/backend.ts`. Tests pass a zero-argument stub, which stays
   * assignable.
   */
  createTransport(track: Track): StreamFn
  transcriber: Transcriber
  store?: SessionStore
  /** Milliseconds since the epoch, injectable so tests don't depend on wall time. */
  now?(): number
  /** Milliseconds of inactivity before an orphaned session is reaped. Defaults to 5 minutes. */
  idleMs?: number
  /** Injectable so tests never spawn a real ffmpeg process. */
  transcode?(inputPath: string, outputPath: string): Promise<void>
  /**
   * Directory the built React client is served from (Vite's `build.outDir`).
   * Defaults to `<root>/voice/dist`. Overridable so tests can point at a
   * small fixture directory instead of depending on a real `vite build`.
   */
  distDir?: string
  /**
   * Run coding drills clarify-first: the problem route withholds the written
   * statement until it is asked for a second time, and the interviewer opens
   * with a deliberately underspecified spoken framing. See `CLARIFY_FIRST` in
   * `voice/context.ts` for what it is for and the evidence behind it.
   *
   * A dep rather than a read of `process.env` down in the route, so tests set it
   * by construction and never by mutating the environment. `main()` reads
   * `VOICE_VAGUE` and passes it through.
   *
   * Coding only. The design track's whole premise is an open-ended prompt that
   * stays on screen for forty-five minutes, and the debugging track's bug report
   * is already written the way a real one would be.
   */
  vague?: boolean
  /**
   * PEM cert and key. When present the server speaks HTTPS instead of HTTP —
   * required by Arc, which unlike Chrome does not treat plain-HTTP localhost
   * as a secure context and so never exposes `navigator.mediaDevices`.
   * Absent in every test, which keeps them on plain HTTP.
   */
  tls?: { cert: Buffer; key: Buffer } | null
  /**
   * Speaks a sentence aloud through the server — the browser has no API to
   * route `SpeechSynthesis` to a chosen output device, but the server runs on
   * the same machine, so it can shell out to `say -a <id>` instead (see
   * `voice/speech.ts`). Optional so no test ever invokes a real `say`; every
   * test in this repo omits it, which makes `streamTurn` a no-op speaker and
   * leaves the SSE `sentence`/`entry` events — the actual source of truth for
   * the transcript — completely unaffected. `main()` wires the real one.
   */
  speaker?: Speaker
  /** Injectable so tests never shell out to the real `say -a '?'`. */
  listOutputDevices?(): Promise<Device[]>
  /**
   * The vitest runner behind `POST /api/session/:id/tests`. Injectable for the
   * same reason `transcode` is: a real run spawns `npx vitest` on one of Andre's
   * own drills, which takes seconds and depends on whatever he has half-written
   * in `solution.ts`. See `DrillTestOptions.runner` for the contract.
   */
  runDrillTests?(args: string[], cwd: string, reportPath: string): Promise<void>
  /** The same contract as `runDrillTests`, for the debugging track's two suites. */
  runDebugTests?(args: string[], cwd: string, reportPath: string): Promise<void>
  /**
   * Which backend and model a track runs on, recorded in the transcript header.
   * Injectable so a test's transcript does not depend on the environment the
   * suite happens to run in; defaults to the real per-track choice.
   */
  transportLabel?(track: Track): string
}

// A recorded interview turn is at most a few minutes of audio; 25MB is a wide
// margin over that even at a generous bitrate. Reading an unbounded body
// straight into memory is a trivial way for a single request to exhaust it.
const MAX_TURN_AUDIO_BYTES = 25 * 1024 * 1024

// A device-config PATCH body is a couple of short string fields — a few
// hundred bytes at most. 4KB is a wide margin, not a guess, and rejecting
// anything past it costs nothing a real client would ever hit.
const MAX_DEVICE_CONFIG_BODY_BYTES = 4 * 1024

/** Reads and JSON-parses a small request body. Malformed or oversized input yields `null`. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    total += buf.length
    if (total > MAX_DEVICE_CONFIG_BODY_BYTES) return null
    chunks.push(buf)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Reads a `{ track, problem, budgetMinutes }` session request off the wire.
 *
 * An absent body means the behavioural mock, which is what every client sent
 * before the design track existed and what the drill defaults to.
 *
 * This is the only client input on this server that reaches a filesystem path,
 * so it validates rather than coerces: an unknown track, a design request with
 * no problem, or a problem that is not a plain slug is a 400, not a
 * best-effort guess. `buildSystemPrompt` independently re-validates the slug
 * and re-runs `assertNoSpoilers` on the paths it derives, so the spoiler gate
 * never rests on this function being right.
 */
export function parseDrill(body: Record<string, unknown> | null): Drill {
  const track = body?.track ?? 'mock'
  if (track !== 'mock' && track !== 'design' && track !== 'coding' && track !== 'coach' && track !== 'debug') {
    throw new Error(`Unknown track: ${String(track)}`)
  }
  if (track === 'mock') {
    // Optional: absent means the interviewer picks, which is the default. The
    // slug is validated here like every other client-supplied path segment, and
    // resolved against the real headings at session creation — an unknown slug
    // is a 400 there rather than a silently unfocused drill.
    const competency = body?.competency
    if (competency === undefined || competency === null || competency === '') return { track }
    if (typeof competency !== 'string' || !PROBLEM_SLUG.test(competency)) {
      throw new Error(`Invalid competency name: ${String(competency)}`)
    }
    return { track, competency }
  }

  const problem = body?.problem
  if (typeof problem !== 'string' || problem === '') {
    throw new Error(`A ${track} drill needs a problem name.`)
  }
  if (!PROBLEM_SLUG.test(problem)) {
    throw new Error(`Invalid problem name: ${problem}`)
  }

  // Coaching is untimed, and deliberately so: a clock turns pairing back into a
  // test. An untimed session gets no `turnCue` time check either, so nothing
  // downstream tells the coach it has a deadline.
  if (track === 'coach') return { track, problem }

  // `design.md` says 45 minutes "unless he says otherwise", so the budget is
  // overridable — bounded, because it drives a countdown the drill is graded
  // against and a nonsense value would quietly make the timing meaningless.
  const raw = body?.budgetMinutes
  let budgetMs =
    track === 'coding' ? CODING_BUDGET_MS : track === 'debug' ? DEBUG_BUDGET_MS : DESIGN_BUDGET_MS
  if (raw !== undefined) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 5 || raw > 180) {
      throw new Error('budgetMinutes must be a number between 5 and 180.')
    }
    budgetMs = Math.round(raw) * 60_000
  }

  // Coding track only: where the answer is written. Absent (or an empty/null
  // value) means the candidate's own editor, the long-standing default — this
  // does not coerce an unrecognised value, the same style as `competency`
  // above, since this is the one place client input reaches a filesystem path.
  const editor = body?.editor
  if (editor !== undefined && editor !== null && editor !== '') {
    if (track !== 'coding' || (editor !== 'browser' && editor !== 'own')) {
      throw new Error(`Invalid editor mode: ${String(editor)}`)
    }
    return { track, problem, budgetMs, editor }
  }
  return { track, problem, budgetMs }
}

/**
 * The design problems available to drill — directory names under
 * `system-design/`, nothing more.
 *
 * Names only, deliberately: the directory also holds `reference.md`, a worked
 * design and an outright spoiler. Listing directories cannot read it, and
 * `assertNoSpoilers` guards the one route that does read a file from here.
 */
function listDesignProblems(root: string): string[] {
  const dir = join(root, 'system-design')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && PROBLEM_SLUG.test(entry.name))
    // A directory with no README is not an exercise yet, and offering it in the
    // picker is worse than omitting it: the prompt is the whole drill, so
    // selecting one produced a 400 from `buildSystemPrompt`'s missing-file throw
    // and no way to tell from the screen whether the server or the choice was
    // broken. Authoring an exercise starts by creating a directory, so this state
    // is a normal few minutes rather than a corrupt repo — `listExercises` on the
    // debugging track has required the same thing from the start.
    .filter((entry) => existsSync(join(dir, entry.name, 'README.md')))
    .map((entry) => entry.name)
    .sort()
}

/**
 * The pattern directory a coding problem lives in, or a throw naming the slug.
 *
 * Throws rather than returning `null` so an unknown slug reaches the same 400
 * path as any other unknown problem, and so no caller can accidentally carry on
 * with `undefined` — `allowedPaths` would then build `problems/undefined/...`
 * and fail with a far less useful message.
 */
function codingPattern(root: string, problem: string): string {
  const found = findCodingProblem(root, problem)
  if (!found) throw new Error(`Unknown problem "${problem}": no coding drill by that name.`)
  return found.pattern
}

function serveStatic(distDir: string, pathname: string, res: ServerResponse): boolean {
  const resolved = resolveStaticFile(distDir, pathname)
  if (!resolved) return false
  res.writeHead(200, { 'content-type': resolved.contentType })
  res.end(readStaticFile(resolved))
  return true
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'not found' })
}

function writeSSE(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type TranscriptionResult = { ok: true; text: string } | { ok: false; message: string; retain: { path: string; kind: 'wav' | 'webm' } }

/**
 * Transcodes (if needed) and transcribes one turn's audio, and decides which
 * file — if any — is worth keeping for a retry on failure.
 *
 * `source.kind === 'webm'` covers both a fresh upload (`POST /turn`) and a
 * retry of a previously-webm-only retained turn (transcode failed last time,
 * so there is no wav yet); `'wav'` covers a retry of a turn whose transcode
 * already succeeded last time, in which case this skips straight to
 * transcription — the whole point of retaining the wav over the webm when
 * both are available.
 *
 * On failure, retains whichever file is cheapest for the *next* attempt: the
 * wav if one now exists (transcode succeeded, transcription didn't) — and in
 * that case the webm this attempt started from, if any, is no longer needed
 * and is deleted, not left behind. On success, both the webm (if any) and the
 * intermediate wav are deleted — there is nothing left to retry.
 */
async function transcribeWithRetention(
  transcode: (input: string, output: string) => Promise<void>,
  transcriber: Transcriber,
  source: { path: string; kind: 'wav' | 'webm' },
  wavScratchPath: string,
  /** Vocabulary hints for the decoder — see `voice/vocabulary.ts`. */
  prompt?: string,
): Promise<TranscriptionResult> {
  let wavPath: string
  let transcodedThisAttempt = false
  if (source.kind === 'wav') {
    wavPath = source.path
  } else {
    wavPath = wavScratchPath
    try {
      await transcode(source.path, wavPath)
      transcodedThisAttempt = true
    } catch (error) {
      // Transcode itself failed — nothing better than the original webm exists yet.
      return { ok: false, message: errorMessage(error), retain: { path: source.path, kind: 'webm' } }
    }
  }
  try {
    const { text } = await transcriber.transcribe(wavPath, prompt)
    if (source.kind === 'webm') await unlink(source.path).catch(() => {})
    await unlink(wavPath).catch(() => {})
    return { ok: true, text }
  } catch (error) {
    if (transcodedThisAttempt) {
      // The wav this attempt just produced is cheaper to retry from than the
      // webm it came from — keep the wav, drop the now-superseded webm.
      await unlink(source.path).catch(() => {})
      return { ok: false, message: errorMessage(error), retain: { path: wavPath, kind: 'wav' } }
    }
    // Already started from a wav (a retry of a wav-stage failure) — nothing new to swap in.
    return { ok: false, message: errorMessage(error), retain: { path: source.path, kind: 'wav' } }
  }
}

/**
 * Records a failed turn's retained audio against the session, replacing (and
 * deleting) whatever was retained before — per the recovery design, only the
 * most recent failed turn's audio is ever kept.
 */
async function setRetainedAudio(stored: StoredSession, retain: Pick<RetainedAudio, 'path' | 'kind'>, at: number): Promise<void> {
  if (stored.retainedAudio && stored.retainedAudio.path !== retain.path) {
    await unlink(stored.retainedAudio.path).catch(() => {})
  }
  stored.retainedAudio = { ...retain, at }
}

/** Drops whatever audio is currently retained for a session, if any. Idempotent. */
async function clearRetainedAudio(stored: StoredSession): Promise<void> {
  if (!stored.retainedAudio) return
  await unlink(stored.retainedAudio.path).catch(() => {})
  stored.retainedAudio = undefined
}

// Speaks one sentence through the server-side TTS, if any was configured.
// Swallows and logs a failure rather than propagating it: `say` failing, or
// the chosen output device having vanished, must degrade to silent-but-
// visible — the sentence has already been delivered to the client over SSE
// by the time this is called, so a dead speaker must not kill the session or
// lose the transcript.
async function speakSentence(speaker: Speaker | undefined, text: string): Promise<void> {
  if (!speaker) return
  try {
    await speaker.speak(text)
  } catch (error) {
    console.error('voice TTS failed, continuing silently:', error)
  }
}

/**
 * Whether anyone is listening.
 *
 * TTS runs on the server, so nothing about a closed or reloaded page stops a
 * `say` already in progress — and the reply generator is deliberately drained to
 * completion even with no client attached, so the session's state advances. Those
 * two facts together meant a refresh left the interviewer talking to an empty
 * room, and on the coding track `beforeunload`'s `/end` beacon then started a
 * whole closing verdict for nobody.
 *
 * Draining is still right; *speaking* while nobody is connected never was. This
 * is checked per sentence rather than once per turn, because the page can go away
 * mid-reply — which is the case that was actually audible.
 */
function hasListener(store: SessionStore, id: string): boolean {
  return store.get(id)?.sseClient !== undefined
}

// `res` is optional: a turn can be submitted with no live SSE connection (the
// browser tab closed, or never reconnected), and the reply must still be
// drained to completion so the session's entries/endedEarly state advances —
// there is simply nowhere to write the sentence events.
//
// Sequencing: the `sentence` SSE event is written *before* awaiting playback,
// so the transcript/caret keep updating live even though this generator only
// advances to the next sentence once the current one has finished speaking.
// Awaiting each `speakSentence` in turn — rather than firing them all — is
// what prevents overlapping, gibberish-inducing calls to `say`; it does not
// stall the SSE stream, because the write already happened.
async function streamTurn(
  res: ServerResponse | undefined,
  turn: AsyncIterable<string>,
  speaker?: Speaker,
  /**
   * Re-checked before every sentence. Absent means "always speak", which is what
   * the design track's CLI path wants — it has no SSE client to lose.
   */
  listening?: () => boolean,
): Promise<void> {
  for await (const sentence of turn) {
    if (res) writeSSE(res, 'sentence', { speaker: 'interviewer', text: sentence })
    // The sentence is already on the wire and already in the transcript; only
    // the audio is conditional. A reader who reconnects sees everything said
    // while they were gone — they just do not hear the part they missed, which
    // is the same deal a spoken interview gives you.
    if (listening === undefined || listening()) await speakSentence(speaker, sentence)
  }
}

/**
 * The `finishSession` options for a stored session, built once so every exit path
 * writes the same thing.
 *
 * `elapsedMs` is read from the session's own entry clock, which is the same clock
 * `Entry.at` uses — so the logged duration and the transcript's timestamps cannot
 * disagree. The pattern is re-resolved here rather than stored; see the comment in
 * POST /api/session.
 */
function finishOptions(deps: VoiceServerDeps, stored: StoredSession, elapsedMs: number) {
  return {
    root: deps.root,
    userId: null,
    transport: (deps.transportLabel ?? transportLabel)(stored.drill.track),
    // The session's own drill, not a hardcoded 'mock' — a design session's
    // transcript belongs under local/designs/<problem>-live-..., and naming it
    // as a mock would file it in the wrong place under the wrong name.
    track: stored.drill.track,
    problem: stored.drill.problem,
    startedAt: stored.startedAt,
    // Coding track only — a design or behavioural drill has no editing mode,
    // and `formatSession` treats an absent value as "omit the line" rather
    // than guessing.
    editor: stored.drill.track === 'coding' ? stored.drill.editor : undefined,
    // Both drilling tracks write a row, into the same table, because `/status`
    // and the history screen read exactly one log. `debug.md` says to set
    // `Pattern` to `debugging`, which is why that column is a plain string here
    // rather than something resolved off a directory: on the coding track the
    // pattern *is* a directory, and on this one there is no pattern at all.
    drill:
      (stored.drill.track === 'coding' || stored.drill.track === 'debug') && stored.drill.problem
        ? {
            pattern:
              stored.drill.track === 'debug' ? 'debugging' : codingPattern(deps.root, stored.drill.problem),
            hints: stored.hintRung,
            elapsedMs,
          }
        : undefined,
  }
}

/**
 * Stop the speaker and end the session for a client that has gone away, and
 * never throw doing it.
 *
 * This runs inside an `IncomingMessage` `'close'` handler, where there is no
 * caller to hand an error to: a throw becomes an unhandled exception and takes
 * the whole drill server down — at a disconnect, which is the moment you are
 * least likely to be watching.
 *
 * Everything it calls can throw *by design*. `endAndPersist` reaches
 * `transportLabel` -> `chooseBackend`, which throws when no backend has been
 * chosen, and `codingPattern`, which throws on a slug it cannot resolve.
 * `speaker.stop()` kills a subprocess whose audio device may have vanished.
 * Those throws are correct where they are — they stop a drill starting on a
 * transport nobody picked — but here the page is already gone and there is
 * nothing to act on. A drill that ended badly beats a server that is not
 * running.
 *
 * Two `try` blocks rather than one: a speaker that fails to stop must not cost
 * the transcript, which is the only artifact a finished drill leaves behind.
 */
export function teardownDisconnectedClient(
  deps: VoiceServerDeps,
  store: SessionStore,
  entryClocks: Map<string, () => number>,
  closing: Set<string>,
  id: string,
): void {
  try {
    deps.speaker?.stop?.()
  } catch (error) {
    console.error(`teardown: could not stop the speaker: ${errorMessage(error)}`)
  }
  try {
    endAndPersist(deps, store, entryClocks, closing, id)
  } catch (error) {
    console.error(`teardown: could not end session ${id}: ${errorMessage(error)}`)
  }
}

/**
 * Ends a session and writes everything it produced.
 *
 * `closing` is the latch, and it is not optional bookkeeping. `store.get(id)`
 * alone is not a guard against a second caller: POST /end awaits a closing
 * interviewer turn — a real model minute — and the session stays in the store
 * for all of it, so any other exit path reached in that window (a second End
 * press, `beforeunload`'s `sendBeacon`, the idle reaper, DELETE /api/session)
 * used to persist a *second* transcript and, because the first finisher had
 * already deleted the entry clock, log the drill's time as `00:00`. Both were
 * observed in a real drill on 2026-08-10.
 *
 * Returns null when the session is gone or already ending, so a route can answer
 * 404 or 409 rather than reporting a second success for one session.
 */
function endAndPersist(
  deps: VoiceServerDeps,
  store: SessionStore,
  entryClocks: Map<string, () => number>,
  closing: Set<string>,
  id: string,
  /**
   * Elapsed milliseconds, when the caller sampled it before doing something
   * slow. POST /end must: reading the clock *after* its closing turn would fold
   * the model's own thinking time into the drill's logged duration.
   */
  elapsedOverride?: number,
): FinishResult | null {
  const stored = store.get(id)
  if (!stored) return null
  if (closing.has(id)) return null
  closing.add(id)
  const elapsedMs = elapsedOverride ?? entryClocks.get(id)?.() ?? 0
  const result = finishSession(stored.session, stored.interviewer, finishOptions(deps, stored, elapsedMs))
  // A coaching session records that it happened, and nothing else — no verdict,
  // no rung, no solved flag, because none of those were measured. See
  // voice/coached.ts for why this is not a drill-log row.
  if (stored.drill.track === 'coach' && stored.drill.problem) {
    // `findCodingProblem` rather than `codingPattern`, which throws: this runs
    // after the transcript is already written, and the transcript is the product
    // of the session. A directory that has moved or been renamed since the
    // session started must not be able to take the SSE `ended` event and the
    // scratch-directory cleanup down with it. An unresolvable pattern is
    // recorded as `unknown`, which is true.
    const found = findCodingProblem(deps.root, stored.drill.problem)
    appendCoached(deps.root, null, {
      date: isoDate(stored.startedAt),
      problem: stored.drill.problem,
      pattern: found?.pattern ?? 'unknown',
      minutes: Math.round(elapsedMs / 60_000),
    })
  }
  if (stored.sseClient) {
    writeSSE(stored.sseClient, 'ended', { endedEarly: stored.session.endedEarly() ?? null, relPath: result.relPath })
    stored.sseClient.end()
  }
  store.remove(id)
  entryClocks.delete(id)
  closing.delete(id)
  // Every session's scratch directory is created in POST /api/session and
  // must not outlive the session — per-turn files are already unlinked as
  // they're consumed, but the directory itself was never removed on any exit
  // path until now.
  rmSync(stored.scratchDir, { recursive: true, force: true })
  return result
}

export function createVoiceServer(deps: VoiceServerDeps): Server {
  // Two different clocks, deliberately not the same function:
  //
  // `idleClock` is cross-session bookkeeping (lastActivity/reapIdle). It only
  // ever needs internal consistency — every read compares two values it
  // itself produced — so a plain wall clock is correct and has no zero-point
  // to get wrong.
  //
  // `Entry.at` is different: it's elapsed milliseconds *since that session
  // started*, not wall time — `transcript.ts` renders it as `[mm:ss]` and the
  // drill grades pacing off it. `cli.ts` gets this right by capturing
  // `started = Date.now()` once and subtracting, but that only works there
  // because a CLI process is one-shot: process start and session start are
  // the same instant. This server is long-running and can serve many
  // sessions back to back, so a single `Date.now() - <server start>` default
  // shared across all of them would give the second session's first entry an
  // `at` equal to however long the server had already been up — the same
  // class of bug as stamping raw epoch, just with a smaller, sneakier offset.
  // Each session's default clock must therefore be created fresh, at that
  // session's own start.
  const idleClock = deps.now ?? Date.now
  const store = deps.store ?? createSessionStore(undefined, idleClock)
  const transcode = deps.transcode ?? transcodeToWav
  const distDir = deps.distDir ?? join(deps.root, 'voice/dist')
  // Sessions whose POST /turn is still being processed (transcode/transcribe/
  // reply-stream in flight) — guards against a second /turn for the same
  // session landing before the first has finished.
  const turnsInFlight = new Set<string>()
  // A monotonic tiebreaker for scratch-file names. `Date.now()` alone can
  // repeat within the same millisecond (two turns landing back to back, or
  // a retry's own scratch wav) and produce a filename collision — harmless
  // for a normal turn (the file is deleted immediately after), but fatal
  // for retained audio, which must survive under a name nothing else reuses.
  let turnFileSeq = 0
  // Per-session elapsed clock for `Entry.at`, keyed by session id. When a
  // caller injects `deps.now` (every test in this repo), all sessions share
  // that one clock, same as before. When nothing is injected (production),
  // each session gets its own clock zeroed at that session's creation.
  const entryClocks = new Map<string, () => number>()
  // Sessions being torn down. See `endAndPersist`: a session is still in the
  // store throughout POST /end's awaited closing turn, so this is what stops a
  // second caller persisting the same session twice.
  const closing = new Set<string>()

  function makeEntryClock(): () => number {
    if (deps.now) return deps.now
    const start = Date.now()
    return () => Date.now() - start
  }

  const idleMs = deps.idleMs ?? 5 * 60_000
  const sweep = setInterval(() => {
    for (const stored of store.reapIdle(idleClock(), idleMs)) {
      endAndPersist(deps, store, entryClocks, closing, stored.id)
    }
  }, Math.min(idleMs, 30_000))
  sweep.unref()

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    // Opt-in request log, for diagnosing a browser we cannot see. Off unless
    // VOICE_DEBUG is set, so default behaviour and the test suite are
    // untouched. Logs method, path and response status only — never a body,
    // because a turn body is captured audio and a response could carry
    // transcribed speech.
    if (process.env.VOICE_DEBUG) {
      const started = Date.now()
      res.once('finish', () => {
        console.error(`[req] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started}ms)`)
      })
    }
    void handleRequest(req, res)
  }

  // `https.Server` extends `http.Server`, so the declared return type holds
  // for both and no caller has to care which one it got.
  return deps.tls ? createHttpsServer({ cert: deps.tls.cert, key: deps.tls.key }, onRequest) : createServer(onRequest)

  /**
   * Whether this user may open the pairing track.
   *
   * Unrestricted unless a deployed instance says otherwise, so a local
   * instance — where opening it is your own choice about your own drilling —
   * is untouched.
   */
  function mayCoach(track: Track, userId: string | null): boolean {
    if (track !== 'coach') return true
    if (deps.mode !== 'deployed') return true
    return userId !== null && deps.coachAllowlist?.has(userId) === true
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && serveStatic(distDir, url.pathname, res)) return

    // Derived once, before any route runs, so no route can forget to ask and
    // read the wrong person's directory. `null` is the local instance, and in
    // local mode this never looks at a header at all.
    const userId = deriveUserId(req, { mode: deps.mode ?? 'local', gatewaySecret: deps.gatewaySecret })
    if (deps.mode === 'deployed' && userId === null && url.pathname.startsWith('/api/')) {
      // Fails closed. A deployed request with no usable identity is a broken
      // edge configuration, and the one thing that must never happen is
      // falling back to a default user — that hands a bare request somebody
      // else's drill log.
      sendJson(res, 401, { error: 'unauthenticated' })
      return
    }

    // Lists speaker/output devices for the client to render a selector.
    // `SpeechSynthesis` exposes no output-device API, so the browser cannot
    // route audio to a chosen speaker on its own — the server speaks instead
    // (see `deps.speaker`/`streamTurn`), which is why this list needs to
    // exist server-side at all.
    if (req.method === 'GET' && url.pathname === '/api/devices/output') {
      try {
        const devices = await (deps.listOutputDevices ?? listOutputDevices)()
        sendJson(res, 200, { devices })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res, 500, { error: message })
      }
      return
    }

    // The persisted device selection, shared with `cli.ts` via the same
    // `local/voice.json` (see `devices.ts`). GET returns the current config;
    // POST merges a partial update into it — e.g. the web client saving its
    // speaker choice must not clobber `input`, which only `cli.ts` ever sets.
    if (url.pathname === '/api/devices/config') {
      if (req.method === 'GET') {
        sendJson(res, 200, readDeviceConfig(deps.root, null))
        return
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req)
        if (!body) {
          sendJson(res, 400, { error: 'invalid request body' })
          return
        }
        const patch: DeviceConfig = {}
        // `output` is the only field the web client has any business writing
        // — `input` is `cli.ts`'s ffmpeg-index space, not the browser's.
        if (typeof body.output === 'string') patch.output = body.output
        if (typeof body.webInput === 'string') patch.webInput = body.webInput
        sendJson(res, 200, writeDeviceConfig(deps.root, null, patch))
        return
      }
    }

    // Recovery path for a 409 from POST /api/session below: the browser has
    // no id for whatever session is stuck (the 409 body never carried one),
    // so this ends whichever session the store currently considers active
    // instead of requiring one. There is at most one, per `hasActive`'s
    // invariant.
    if (req.method === 'DELETE' && url.pathname === '/api/session') {
      const id = store.activeId(userId)
      if (!id) {
        sendJson(res, 404, { error: 'no active session' })
        return
      }
      // `ended: false` rather than a lie: this is the "end it and start fresh"
      // recovery path, and it must not report success for a session whose own
      // /end is mid-closing-turn — the client would then start a new session
      // while the old one is still writing.
      const ended = endAndPersist(deps, store, entryClocks, closing, id) !== null
      sendJson(res, ended ? 200 : 409, ended ? { ended } : { ended, error: 'that session is already ending' })
      return
    }

    // The coding track's working file. Slug-only in and out: a problem's path
    // is `problems/<pattern>/<slug>` and the pattern is the answer, so it never
    // crosses this boundary. See `stripPatternPaths` for the same rule applied
    // to anything derived from test output.
    // POST is accepted as an alias for PUT here solely for
    // `navigator.sendBeacon`, which the browser client's `beforeunload`/
    // unmount best-effort save uses (`voice/web/src/useSolution.ts`) — it is
    // POST-only and the only mechanism guaranteed to still deliver a request
    // once the page has started tearing down. The write path below does not
    // otherwise distinguish the two methods.
    const solutionRoute = /^\/api\/coding\/([^/]+)\/solution$/.exec(url.pathname)
    if (solutionRoute && (req.method === 'GET' || req.method === 'PUT' || req.method === 'POST')) {
      const slug = solutionRoute[1]!
      if (!PROBLEM_SLUG.test(slug)) {
        sendJson(res, 400, { error: 'Invalid problem name.' })
        return
      }

      if (req.method === 'GET') {
        const file = readSolution(deps.root, slug)
        if (file === null) {
          sendJson(res, 404, { error: 'Unknown problem.' })
          return
        }
        sendJson(res, 200, file)
        return
      }

      let body: Record<string, unknown> | null
      try {
        body = await readJsonBody(req)
      } catch (error) {
        sendJson(res, 400, { error: errorMessage(error) })
        return
      }
      const text = body?.text
      const version = body?.version
      if (typeof text !== 'string' || typeof version !== 'string') {
        sendJson(res, 400, { error: 'A save needs `text` and `version`.' })
        return
      }

      const outcome = writeSolution(deps.root, slug, text, version)
      if (outcome === 'missing') {
        sendJson(res, 404, { error: 'Unknown problem.' })
        return
      }
      if (outcome === 'stale') {
        // 409, the same shape `POST /end` uses for its non-re-entrancy latch.
        // The client keeps the typed buffer; it must never resolve this by
        // discarding what the candidate wrote.
        const current = readSolution(deps.root, slug)!
        sendJson(res, 409, {
          error: 'solution.ts changed on disk since you opened it.',
          version: current.version,
        })
        return
      }
      sendJson(res, 200, { version: versionOf(text) })
      return
    }

    // The problem picker for whichever track asked. Names only — see
    // `listDesignProblems`, and `listCodingProblems`, whose whole reason for
    // existing is that a coding problem's *path* names its pattern and so can
    // never be what the client is handed. `?track=` defaults to design, which
    // is what the only client sent before the coding track existed.
    if (req.method === 'GET' && url.pathname === '/api/problems') {
      const track = url.searchParams.get('track') ?? 'design'
      if (
        track !== 'design' &&
        track !== 'coding' &&
        track !== 'mock' &&
        track !== 'coach' &&
        track !== 'debug'
      ) {
        sendJson(res, 400, { error: `Unknown track: ${track}` })
        return
      }
      if (track === 'mock') {
        // Titles and story coverage alongside the slugs, in the same
        // slugs-are-the-payload shape the coding branch uses: `problems` stays a
        // bare string array, so a client that ignores the extra maps still gets a
        // complete list. `hasStory` comes from headings in `local/stories.md` and
        // never its bodies — `mock.md` allows the story bank to be consulted for
        // gaps only, and that stays true of what reaches the browser.
        const competencies = listCompetencies(deps.root, null)
        sendJson(res, 200, {
          problems: competencies.map((c) => c.slug),
          titles: Object.fromEntries(competencies.map((c) => [c.slug, c.title])),
          hasStory: Object.fromEntries(competencies.map((c) => [c.slug, c.hasStory])),
        })
        return
      }
      if (track === 'debug') {
        // Names plus titles, in the same shape the behavioural branch uses. The
        // title is the bug report's headline and is the only thing worth showing
        // in a picker — an exercise name is barely readable, and the report says
        // the same thing in its first line anyway.
        const exercises = listExercises(deps.root)
        sendJson(res, 200, {
          problems: exercises.map((exercise) => exercise.name),
          titles: Object.fromEntries(exercises.map((exercise) => [exercise.name, exercise.title])),
        })
        return
      }
      if (track !== 'coding' && track !== 'coach') {
        sendJson(res, 200, { problems: listDesignProblems(deps.root) })
        return
      }
      // Slugs stay the payload's shape — the pattern is the spoiler and never
      // leaves this process — with difficulty alongside as a separate map rather
      // than folded into the entries. Keeping `problems` a bare string array
      // means the design branch above and every existing client keep working
      // unchanged, and a client that ignores `difficulties` still gets a
      // complete, correct list.
      // `coach` shares the coding problem set — it is the same thirty problems,
      // approached the other way round.
      const coding = listCodingProblems(deps.root)
      sendJson(res, 200, {
        problems: coding.map((problem) => problem.slug),
        difficulties: Object.fromEntries(coding.map((problem) => [problem.slug, problem.difficulty])),
      })
      return
    }

    // Past drills, for the history screen. Read from `local/drill-log.md`, which
    // is the only structured record any track keeps — the design and behavioural
    // tracks write free-form transcripts and no scores, so there is nothing
    // comparable to report for them.
    //
    // **The pattern is withheld unless asked for.** The log carries it, and it is
    // his own file, but a history screen is read *between* drills — and
    // `/review` exists partly to re-queue a problem for spaced repetition. A
    // permanent list of problem-to-pattern on screen would spoil every re-drill
    // at a glance. Same reasoning as `voice/problems.ts`: keep it off the wire so
    // the guarantee is structural rather than the client remembering to hide a
    // field it was handed.
    if (req.method === 'GET' && url.pathname === '/api/history') {
      const withPatterns = url.searchParams.get('patterns') === '1'
      const rows = readDrillLog(deps.root, null)
      sendJson(res, 200, {
        summary: summarise(rows),
        rows: rows.map(({ pattern, ...row }) => (withPatterns ? { ...row, pattern } : row)),
        // Which problems have been paired on. Sent unconditionally, unlike the
        // pattern: a coaching session is something he chose and sat through, so
        // there is nothing to spoil by saying it happened. It is here because a
        // cold solve of a problem he was walked through is a weaker fact than a
        // cold solve of one he was not, and the screen leads with the cold count.
        coached: readCoachedProblems(deps.root, null),
      })
      return
    }

    // The problem statement for the design pane: `README.md` and nothing else.
    //
    // Andre is *meant* to read this — it is the prompt, the design equivalent of
    // hearing the behavioural question. `rubric.md` is not served even though it
    // is not a DENIED file: it enumerates the dimensions being scored, so
    // putting it on screen mid-drill would hand him the checklist the drill
    // exists to see whether he reaches for unprompted. `reference.md` is a
    // worked design and is DENIED outright — `assertNoSpoilers` below is what
    // makes that structural rather than a matter of this route staying careful.
    const problemMatch = /^\/api\/problems\/([^/]+)$/.exec(url.pathname)
    if (req.method === 'GET' && problemMatch) {
      const problem = decodeURIComponent(problemMatch[1]!)
      const track = url.searchParams.get('track') ?? 'design'
      if (track !== 'design' && track !== 'coding' && track !== 'coach' && track !== 'debug') {
        sendJson(res, 400, { error: `Unknown track: ${track}` })
        return
      }
      if (!PROBLEM_SLUG.test(problem)) {
        sendJson(res, 400, { error: `Invalid problem name: ${problem}` })
        return
      }
      let relPath: string
      // Coaching serves the same README as a coding drill and nothing more. The
      // spoilers a coach may read reach the model through `coachPaths`, never
      // through a route the browser can call — putting the worked solution on
      // screen would spoil a re-drill of the same problem later, and this route
      // has no idea which mode the page thinks it is in.
      if (track === 'debug') {
        // The bug report, and only ever that. `src/**` is where the defect is and
        // no route serves it — he reads the code in his own editor, the same way
        // the coding track has him write code in his own editor. Resolved off disk
        // so an unknown exercise is a 404 rather than a path built from a slug.
        const found = findExercise(deps.root, problem)
        if (!found) {
          notFound(res)
          return
        }
        relPath = `debugging/${found.name}/README.md`
      } else if (track === 'coding' || track === 'coach') {
        // Resolved off disk rather than built from the slug, because only the
        // resolver knows the pattern directory — and the response deliberately
        // carries the slug back, never the path it was found at.
        const found = findCodingProblem(deps.root, problem)
        if (!found) {
          notFound(res)
          return
        }
        relPath = `${problemDir(found)}/README.md`

        // Clarify-first: the statement is withheld ON THE WIRE, and reaching it
        // is a second, explicit request. Hiding it in the client instead would
        // be the mistake `?patterns=1` exists to avoid — the pane would hold the
        // answer to "what is actually being asked" in memory while claiming not
        // to, one devtools tab away, and the drill would quietly stop meaning
        // anything. `reveal=1` is not a secret and is not meant to be: the point
        // is that taking it is a deliberate act, the same shape as asking for a
        // hint, not that it is hard to do.
        //
        // Coaching is excluded: a coach is explaining a pattern after the fact,
        // and withholding the problem from that conversation is nonsense.
        if (deps.vague && track === 'coding' && url.searchParams.get('reveal') !== '1') {
          sendJson(res, 200, { problem, prompt: CLARIFY_FIRST_BRIEF, vague: true })
          return
        }
      } else {
        relPath = `system-design/${problem}/README.md`
      }
      assertNoSpoilers([relPath])
      const full = join(deps.root, relPath)
      if (!existsSync(full)) {
        notFound(res)
        return
      }
      sendJson(res, 200, { problem, prompt: readFileSync(full, 'utf8') })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/session') {
      // Read the body FIRST, before the single-session check.
      //
      // This is the only `await` in this handler, and reading a body means
      // yielding to the event loop for as long as the client takes to finish
      // sending. Checking `hasActive()` before that await and creating after it
      // leaves a window where two concurrent requests both see no active
      // session and both create one — breaking the one invariant this route
      // exists to hold. Ordering it this way puts the check and the create in
      // the same synchronous run, which is what actually makes it atomic here.
      //
      // This route is also the only place client input reaches a filesystem
      // path, so `parseDrill` validates rather than coerces; `buildSystemPrompt`
      // then re-runs `PROBLEM_SLUG` and `assertNoSpoilers` on the paths it
      // derives, so the spoiler gate never rests on this parse being correct.
      let drill: Drill
      try {
        drill = parseDrill(await readJsonBody(req))
      } catch (error) {
        sendJson(res, 400, { error: errorMessage(error) })
        return
      }

      // Checked here rather than deeper in, because the coach track's whole
      // job is to serve `solutions/**` and `patterns.md` — by the time any
      // coach code runs, the answer key is already being assembled.
      if (!mayCoach(drill.track, userId)) {
        sendJson(res, 403, { error: 'the coach track is not available on this instance' })
        return
      }

      if (store.hasActive(userId)) {
        // The 409 carries the stuck session's id and start time so the client
        // can offer both recoveries the design calls for: end it, or open it.
        // Without the id there was nothing to reopen and nothing honest to put
        // in the banner's "a session started at 07:12" — see ERROR_COPY.stuck.
        const active = store.get(store.activeId(userId)!)!
        sendJson(res, 409, {
          error: 'a session is already in progress',
          id: active.id,
          startedAt: active.startedAt.toISOString(),
        })
        return
      }

      const entryClock = makeEntryClock()
      let system: string
      try {
        // The pattern is resolved here and passed straight into the prompt. It
        // is deliberately not stored on the session: `stored.drill` is spread
        // into `POST /api/session`'s and `GET /api/session/:id`'s response
        // bodies, so anything living there is one field-add away from being
        // shipped to the browser. `POST .../tests` re-resolves it instead —
        // a directory scan, which costs nothing next to running a test suite.
        const pattern =
          drill.track === 'coding' || drill.track === 'coach'
            ? codingPattern(deps.root, drill.problem!)
            : undefined
        if (drill.track === 'coach') {
          // A separate builder, not a branch of `buildSystemPrompt`: that
          // function goes through `allowedPaths` and `assertNoSpoilers`, both of
          // which refuse this track on purpose. See voice/coach.ts.
          system = buildCoachPrompt(deps.root, null, { slug: drill.problem!, pattern: pattern! })
        } else {
          // Resolved against the real headings, so an unknown slug fails here as a
          // 400 rather than quietly producing an unfocused drill the candidate
          // thinks is focused.
          let focus: string | undefined
          if (drill.competency) {
            const found = findCompetency(deps.root, null, drill.competency)
            if (!found) throw new Error(`Unknown competency "${drill.competency}": no such behavioral competency.`)
            focus = found.title
          }
          // The same flag the problem route reads, so the interviewer's
          // instructions and what the client can fetch cannot disagree. A prompt
          // told to withhold a statement the pane is already showing would be a
          // rule with no teeth, and the reverse — a withheld statement nobody
          // describes out loud — would just be a broken drill.
          system = buildSystemPrompt(
            deps.root,
            null,
            drill.track,
            drill.problem,
            pattern,
            focus,
            deps.vague === true && drill.track === 'coding',
          )
        }
      } catch (error) {
        // An unknown problem slug reaches here as a missing-file throw from
        // buildSystemPrompt. That is the client asking for something that does
        // not exist, not a server fault — 400, and no session is created.
        sendJson(res, 400, { error: errorMessage(error) })
        return
      }
      const interviewer = createInterviewer(system, deps.createTransport(drill.track))
      const session = createSession({
        interviewer,
        now: () => entryClock(),
        // Only the timed track gets a cue; a behavioural mock has no budget and
        // must not be told it has one.
        // One cue slot, two uses, mutually exclusive by track. Coaching is
        // untimed and instead gets the working file every turn — that is what
        // makes it pairing rather than another interview, and it is re-read per
        // turn rather than captured once because the whole point is that he is
        // editing it while they talk.
        turnCue:
          drill.track === 'coach'
            ? () => codeCue(readWorkingFile(deps.root, { slug: drill.problem!, pattern: codingPattern(deps.root, drill.problem!) }))
            : drill.budgetMs === undefined
              ? undefined
              : () => timeCue(entryClock(), drill.budgetMs),
      })
      const scratchDir = mkdtempSync(join(tmpdir(), 'voice-web-'))
      const stored = store.create(session, interviewer, new Date(), scratchDir, drill, userId)
      entryClocks.set(stored.id, entryClock)
      sendJson(res, 201, { id: stored.id, ...drill })
      return
    }

    // Reopening a session the browser lost track of (a reload, a crash, a
    // closed tab). SSE replays nothing, so a client that reconnects to
    // `/stream` alone would show an empty transcript for a session that is
    // several turns deep. This hands back the state it needs to catch up.
    //
    // `entries` is the same shape the SSE `entry` events carry and, like them,
    // never includes `interviewer.lastRaw()` — the raw reply can hold a
    // story-log trailer, which is transcript-only and must not reach the
    // browser. See voice/spoiler-gate.test.ts.
    const readMatch = /^\/api\/session\/([^/]+)$/.exec(url.pathname)
    if (req.method === 'GET' && readMatch) {
      const id = readMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }
      sendJson(res, 200, {
        id: stored.id,
        startedAt: stored.startedAt.toISOString(),
        entries: stored.session.entries(),
        awaitingRetry: stored.retainedAudio !== undefined,
        // So a reopened coding drill shows the help already taken rather than
        // resetting the counter to zero and reading as a cold attempt.
        hintRung: stored.hintRung,
        // So a reopened design session restores its problem pane and resumes
        // its countdown from the right place rather than looking like a mock.
        ...stored.drill,
      })
      return
    }

    const streamMatch = /^\/api\/session\/([^/]+)\/stream$/.exec(url.pathname)
    if (req.method === 'GET' && streamMatch) {
      const id = streamMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }

      if (stored.sseClient) {
        // A reconnect: the previous response has no reader left on the other
        // end, and a turn already in flight could still write to it. End it
        // explicitly rather than leaving it open until its own socket happens
        // to close — that would let the stale response linger indefinitely
        // and race the new one for writes. Ending it here (rather than
        // refusing the new connection) is what lets `EventSource`'s built-in
        // auto-reconnect actually recover a dropped connection.
        stored.sseClient.end()
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      // `writeHead` only queues the status line and headers — Node doesn't
      // actually put them on the wire until the first `write()`/`end()`, per
      // its own docs. A reconnect that lands after the opening turn has
      // already streamed (the common case: the drill has been running for a
      // while) writes nothing else until the next real event, so without an
      // explicit flush here the new connection's headers would sit buffered
      // indefinitely and the client would hang waiting for a response that
      // was, from Node's perspective, already "sent".
      res.flushHeaders()
      stored.sseClient = res

      req.on('close', () => {
        // This handler is registered once per connection, but a reconnect
        // (above) proactively ends the *previous* response, which fires
        // *that* response's own already-registered 'close' handler. By the
        // time it fires, `stored.sseClient` has already been reassigned to
        // the new connection's response — so only tear down the session if
        // this handler's own `res` is still the current client. Otherwise a
        // stale handler from an ended, superseded response would run
        // `endAndPersist` and kill the session (and the brand-new
        // connection) out from under a live reconnect.
        if (store.get(id)?.sseClient !== res) return
        // Mark the client gone *before* anything else, so a turn mid-flight sees
        // it on its next sentence — `streamTurn` re-reads `hasListener` per
        // sentence and this is what makes that check true-to-life.
        stored.sseClient = undefined
        // And cut the sentence already in the speaker's mouth. Nothing else can:
        // `say` is a server-side subprocess, so the page closing does not touch
        // it, and a sentence takes seconds to read out.
        teardownDisconnectedClient(deps, store, entryClocks, closing, id)
      })

      const alreadyBegun = stored.session.entries().length > 0
      if (!alreadyBegun) {
        void (async () => {
          const before = stored.session.entries().length
          await streamTurn(res, stored.session.begin(), deps.speaker, () => hasListener(store, id))
          for (const entry of stored.session.entries().slice(before)) {
            writeSSE(res, 'entry', entry)
          }
          if (stored.session.endedEarly()) endAndPersist(deps, store, entryClocks, closing, id)
        })().catch((error: unknown) => {
          console.error('voice session opening turn failed:', error)
        })
      }
      return
    }

    // Shared by a normal turn's success path and a retry's success path:
    // commits the Andre entry, then streams the interviewer's reply exactly
    // as a normal turn would. Owns clearing `turnsInFlight` for both callers.
    function proceedTurn(id: string, stored: StoredSession, text: string, at: number): void {
      sendJson(res, 202, { text })
      void (async () => {
        // `submitTurn` commits the Andre entry synchronously, before the
        // interviewer's reply streams — mirror that ordering on the wire so
        // the browser sees Andre's turn land before the reply's sentences.
        const iterable = stored.session.submitTurn(text, at)
        const before = stored.session.entries().length - 1
        if (stored.sseClient) {
          writeSSE(stored.sseClient, 'entry', stored.session.entries()[before])
        }
        // No live SSE connection is a normal state (a turn submitted between
        // reconnects, say), not a reason to stop draining the reply — the
        // session's entries/endedEarly state must still advance either way.
        await streamTurn(stored.sseClient, iterable, deps.speaker, () => hasListener(store, id))
        if (stored.sseClient) {
          for (const entry of stored.session.entries().slice(before + 1)) {
            writeSSE(stored.sseClient, 'entry', entry)
          }
        }
        if (stored.session.endedEarly()) endAndPersist(deps, store, entryClocks, closing, id)
      })()
        .catch((error: unknown) => {
          console.error('voice session turn failed:', error)
        })
        .finally(() => {
          turnsInFlight.delete(id)
        })
    }

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
      if (turnsInFlight.has(id)) {
        sendJson(res, 409, { error: 'a turn is already in progress for this session' })
        return
      }
      turnsInFlight.add(id)
      store.touch(id, idleClock())

      // The moment the upload arrived is the moment Andre's turn actually
      // ended — sample it before transcode/transcription latency has a
      // chance to leak into the pacing analytics `submitTurn` stamps entries
      // with. Uses this session's own entry clock, not the idle-bookkeeping
      // one — see the comment above `entryClocks`. Also the timestamp a later
      // retry of this same turn must reuse — see `RetainedAudio.at`.
      const entryClock = entryClocks.get(id)!
      const at = entryClock()

      const chunks: Buffer[] = []
      let total = 0
      let tooLarge = false
      for await (const chunk of req) {
        const buf = chunk as Buffer
        total += buf.length
        if (total > MAX_TURN_AUDIO_BYTES) {
          tooLarge = true
          break
        }
        chunks.push(buf)
      }
      if (tooLarge) {
        turnsInFlight.delete(id)
        sendJson(res, 413, { error: 'audio upload too large' })
        req.destroy()
        return
      }
      const audio = Buffer.concat(chunks)

      const inputPath = join(stored.scratchDir, `turn-${Date.now()}-${++turnFileSeq}.webm`)
      const outputPath = join(stored.scratchDir, `turn-${Date.now()}-${++turnFileSeq}.wav`)
      await writeFile(inputPath, audio)

      const result = await transcribeWithRetention(
        transcode,
        deps.transcriber,
        { path: inputPath, kind: 'webm' },
        outputPath,
        transcriptionPrompt(stored.drill.track),
      )
      if (!result.ok) {
        turnsInFlight.delete(id)
        // A transcription failure is recoverable — see the module comment on
        // `transcribeWithRetention` — so unlike before, this no longer calls
        // `session.reportFailure` (that writes a synthetic "[Session ended
        // early — ...]" entry into the transcript for a turn the interviewer
        // genuinely never heard, which would corrupt the record the drill is
        // graded on) and no longer ends the session. The audio is retained
        // instead, and the session stays alive for a retry/abandon.
        await setRetainedAudio(stored, result.retain, at)
        sendJson(res, 422, { error: result.message })
        return
      }

      // A fresh answer supersedes whatever an earlier failed turn retained.
      // The primary "Start answer" action stays live under the error banner by
      // design, so recording again *without* going through "Answer again" is an
      // ordinary path — and if that left the old audio retained, a later
      // "Retry transcription" would append a second entry stamped with the
      // earlier turn's `at`, landing out of order in the graded record.
      await clearRetainedAudio(stored)
      proceedTurn(id, stored, result.text, at)
      return
    }

    const retryMatch = /^\/api\/session\/([^/]+)\/turn\/retry$/.exec(url.pathname)
    if (req.method === 'POST' && retryMatch) {
      const id = retryMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }
      if (stored.session.endedEarly()) {
        sendJson(res, 409, { error: 'session already ended' })
        return
      }
      if (turnsInFlight.has(id)) {
        sendJson(res, 409, { error: 'a turn is already in progress for this session' })
        return
      }
      const retained = stored.retainedAudio
      if (!retained) {
        sendJson(res, 409, { error: 'no retained audio to retry' })
        return
      }
      turnsInFlight.add(id)
      store.touch(id, idleClock())

      const outputPath = join(stored.scratchDir, `retry-${Date.now()}-${++turnFileSeq}.wav`)
      // The same prompt as the first attempt: a retry that decoded with a
      // different vocabulary would not be a retry of the same transcription.
      const result = await transcribeWithRetention(
        transcode,
        deps.transcriber,
        { path: retained.path, kind: retained.kind },
        outputPath,
        transcriptionPrompt(stored.drill.track),
      )
      if (!result.ok) {
        turnsInFlight.delete(id)
        // Stay recoverable, not escalate: same shape as a first-attempt
        // failure, just with the retained file possibly having changed (e.g.
        // a webm that finally transcoded to a wav this time, but then failed
        // to transcribe).
        await setRetainedAudio(stored, result.retain, retained.at)
        sendJson(res, 422, { error: result.message })
        return
      }

      stored.retainedAudio = undefined
      // Reuse the *original* turn's `at`, not this retry's — a retry can
      // happen much later (Andre troubleshooting a mic or a whisper install),
      // and `Entry.at` grades pacing off when he actually finished speaking,
      // not when transcription finally succeeded. See `RetainedAudio.at`.
      proceedTurn(id, stored, result.text, retained.at)
      return
    }

    const abandonMatch = /^\/api\/session\/([^/]+)\/turn\/abandon$/.exec(url.pathname)
    if (req.method === 'POST' && abandonMatch) {
      const id = abandonMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }
      if (turnsInFlight.has(id)) {
        sendJson(res, 409, { error: 'a turn is already in progress for this session' })
        return
      }
      // "Answer again" and "Skip this turn" are the same server-side
      // operation: drop the retained audio and leave the session exactly
      // where a turn that never failed would leave it — ready for the next
      // recording. The two only differ in what the client does next (record
      // a fresh answer to the same still-standing question, vs. moving on
      // without one), which needs no server involvement either way. See the
      // design report for why this collapsed into one endpoint rather than
      // two. Idempotent: abandoning with nothing retained is a no-op, not an
      // error, since a client shouldn't have to track whether it already won
      // this race.
      await clearRetainedAudio(stored)
      sendJson(res, 200, { abandoned: true })
      return
    }

    // "Ask for a hint" — the ladder in `prompts/rules/no-spoilers.md`, made a
    // button rather than a thing to remember to phrase carefully.
    //
    // The rung is counted here, not by the interviewer. The ladder's whole value
    // is that it is rationed ("advance exactly one rung. Never two."), and a model
    // asked for "a hint" reliably over-delivers — so the server owns the count and
    // `hintCue` tells it which single rung is owed, quoting that rung verbatim.
    // That also makes the number `/status` reads a measurement rather than a
    // recollection, and lets the client show a live count.
    //
    // Shares `turnsInFlight` with the spoken turns and the test run for the same
    // reason they share it with each other: this drives an interviewer turn, and
    // two of those at once interleave their sentences.
    const hintMatch = /^\/api\/session\/([^/]+)\/hint$/.exec(url.pathname)
    if (req.method === 'POST' && hintMatch) {
      const id = hintMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }
      const laddered = stored.drill.track
      if (laddered !== 'coding' && laddered !== 'debug') {
        // The behavioural and design tracks have no ladder — `mock.md` and
        // `design.md` define no rungs, so there is nothing here to ration. Nor
        // does pairing, where nothing is rationed at all and the button is not on
        // the screen to begin with.
        sendJson(res, 400, { error: 'this track has no hint ladder' })
        return
      }
      if (stored.session.endedEarly()) {
        sendJson(res, 409, { error: 'session already ended' })
        return
      }
      if (turnsInFlight.has(id)) {
        sendJson(res, 409, { error: 'a turn is already in progress for this session' })
        return
      }
      turnsInFlight.add(id)
      store.touch(id, idleClock())

      // Clamped rather than refused at the top. Rung 4 is the full worked
      // solution, so there is genuinely nothing further to give — but asking
      // again after it is not an error, and answering a 409 would leave the
      // button looking broken at the exact moment he is most stuck.
      //
      // The debugging ladder needs the two numbers kept apart, and this is the
      // only place that matters. `requested` is how far he has asked; `hintRung`
      // is how far he was actually *given*, which is what the drill-log row means
      // by hints and what `/status` reads to tell rust from coverage. On the
      // coding track they are the same number. On the debugging track everything
      // past rung 1 names part of the defect, which this interviewer has not been
      // given and must not be — see DEBUG_HINT_RUNGS — so it says so, and a
      // refusal must not be recorded as help. Counting it would inflate the one
      // number the history screen asks him to trust, the same way a coaching
      // session counted as an attempt would.
      const requested = Math.min(stored.hintRung + 1, laddered === 'debug' ? DEBUG_HINT_RUNGS.length - 1 : MAX_HINT_RUNG)
      const given = laddered === 'debug' ? Math.min(requested, MAX_SERVABLE_DEBUG_RUNG) : requested
      stored.hintRung = given
      // `rung` stays the help taken, so the count on screen keeps meaning the
      // same thing on both tracks. `servable` is how the client knows the ask
      // bought nothing, without having to know the ladder's shape.
      sendJson(res, 200, { rung: given, servable: given === requested })

      void (async () => {
        const before = stored.session.entries().length
        const hint = laddered === 'debug' ? debugHintCue(requested) : hintCue(requested)
        await streamTurn(stored.sseClient, stored.session.interject(hint), deps.speaker, () => hasListener(store, id))
        if (stored.sseClient) {
          for (const entry of stored.session.entries().slice(before)) {
            writeSSE(stored.sseClient, 'entry', entry)
          }
        }
        if (stored.session.endedEarly()) endAndPersist(deps, store, entryClocks, closing, id)
      })()
        .catch((error: unknown) => {
          console.error('voice session hint failed:', error)
        })
        .finally(() => {
          turnsInFlight.delete(id)
        })
      return
    }

    // The coding track's test run — `drill.md` step 7, reassigned. Andre presses
    // a button, the suite runs, and the interviewer is told the outcome and
    // reacts out loud.
    //
    // The verdict reaches the interviewer as a bracketed note through
    // `session.interject`, not through `submitTurn`: he did not say anything, so
    // no Andre entry is written. It also goes back in this response, because the
    // client has to render *something* immediately — a suite can take a while,
    // and the button cannot just go quiet until the interviewer starts speaking.
    //
    // Shares `turnsInFlight` with the spoken turns on purpose. A test run and a
    // recorded answer both drive an interviewer turn, and two interviewer turns
    // racing would interleave sentences into one another and corrupt the
    // transcript's ordering.
    const testsMatch = /^\/api\/session\/([^/]+)\/tests$/.exec(url.pathname)
    if (req.method === 'POST' && testsMatch) {
      const id = testsMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }
      const testable = stored.drill.track
      if (testable !== 'coding' && testable !== 'coach' && testable !== 'debug') {
        sendJson(res, 400, { error: 'this track has no tests to run' })
        return
      }
      if (stored.session.endedEarly()) {
        sendJson(res, 409, { error: 'session already ended' })
        return
      }
      if (turnsInFlight.has(id)) {
        sendJson(res, 409, { error: 'a turn is already in progress for this session' })
        return
      }
      turnsInFlight.add(id)
      store.touch(id, idleClock())

      // Two different verdicts, because the tracks are asking different questions
      // of the same button. A coding drill's suite splits into correctness and
      // cost; a debugging exercise's two files split into root cause and symptom
      // patch. Both reach the interviewer as a bracketed cue that states what the
      // outcome *means*, because in both cases the distinction is the lesson and
      // an interviewer left to infer it gets it wrong in the same direction.
      //
      // Pairing runs the coding suite: the coach is looking at the same
      // `solution.ts` and half of a pairing session is reading a red test
      // together. It was rejected here until the debug track needed the same
      // branch — the button was on the pairing screen and answered 400.
      let verdict: DebugVerdict | Awaited<ReturnType<typeof runDrillTests>>
      try {
        verdict =
          testable === 'debug'
            ? await runDebugTests({
                root: deps.root,
                exercise: stored.drill.problem!,
                runner: deps.runDebugTests,
              })
            : await runDrillTests({
                root: deps.root,
                problem: { slug: stored.drill.problem!, pattern: codingPattern(deps.root, stored.drill.problem!) },
                runner: deps.runDrillTests,
              })
      } catch (error) {
        turnsInFlight.delete(id)
        sendJson(res, 500, { error: errorMessage(error) })
        return
      }
      const cue = testable === 'debug' ? debugVerdictCue(verdict as DebugVerdict) : verdictCue(verdict as Awaited<ReturnType<typeof runDrillTests>>)

      // Answered before the interviewer's reaction streams, same ordering as a
      // spoken turn's 202: the client gets the outcome now, the sentences follow
      // over SSE.
      sendJson(res, 200, verdict)
      void (async () => {
        const before = stored.session.entries().length
        await streamTurn(stored.sseClient, stored.session.interject(cue), deps.speaker, () => hasListener(store, id))
        if (stored.sseClient) {
          for (const entry of stored.session.entries().slice(before)) {
            writeSSE(stored.sseClient, 'entry', entry)
          }
        }
        if (stored.session.endedEarly()) endAndPersist(deps, store, entryClocks, closing, id)
      })()
        .catch((error: unknown) => {
          console.error('voice session test reaction failed:', error)
        })
        .finally(() => {
          turnsInFlight.delete(id)
        })
      return
    }

    const endMatch = /^\/api\/session\/([^/]+)\/end$/.exec(url.pathname)
    if (req.method === 'POST' && endMatch) {
      const id = endMatch[1]!
      const stored = store.get(id)
      if (!stored) {
        notFound(res)
        return
      }
      // Two client paths fire this endpoint — the dock's End session button and
      // `beforeunload`'s `sendBeacon` — and neither can see the other. Latched
      // *before* the awaited closing turn below, because that turn is where the
      // window was: for the whole model minute it takes, the session is still in
      // the store and a second caller sailed past the `store.get` above.
      if (closing.has(id)) {
        sendJson(res, 409, { error: 'this session is already ending' })
        return
      }
      closing.add(id)

      // Sampled here, before the closing turn, because that turn takes a model
      // minute and this number is how long *the drill* took. Reading the clock
      // afterwards logged the interviewer's own thinking time as part of Andre's.
      const elapsedMs = entryClocks.get(id)?.() ?? 0

      // The coding track gets one final interviewer turn before anything is
      // persisted, because its closing verdict and `drill-log` trailer are
      // *produced* by that turn — `finishSession` reads them off
      // `interviewer.lastRaw()`. Without it, the log row existed only for drills
      // that ran the clock all the way down, which is the rarer case.
      //
      // Skipped when a turn is already in flight: "End session" must always end
      // the session, so this never blocks on another turn or races it. The cost is
      // one lost log row in that case, which is the right thing to lose.
      //
      // Also skipped once `endedEarly` is set — the interviewer's stream is
      // already broken, and asking it for one more turn would just fail again.
      // Debugging too, and for exactly the same reason: its closing verdict and
      // its drill-log trailer are *produced* by this turn, so without it a row
      // existed only for exercises that ran the clock all the way down.
      if (
        (stored.drill.track === 'coding' || stored.drill.track === 'debug') &&
        !turnsInFlight.has(id) &&
        !stored.session.endedEarly()
      ) {
        turnsInFlight.add(id)
        try {
          const before = stored.session.entries().length
          await streamTurn(stored.sseClient, stored.session.interject(closingCue()), deps.speaker, () => hasListener(store, id))
          if (stored.sseClient) {
            for (const entry of stored.session.entries().slice(before)) {
              writeSSE(stored.sseClient, 'entry', entry)
            }
          }
        } catch (error) {
          // A failed closing turn costs the verdict and the log row. The
          // transcript is the drill's real product and is still saved below.
          console.error('voice session closing turn failed:', error)
        } finally {
          turnsInFlight.delete(id)
        }
      }

      // `closing` is already held, so this releases it rather than re-taking it:
      // one persist path for every exit, including this one.
      closing.delete(id)
      const result = endAndPersist(deps, store, entryClocks, closing, id, elapsedMs)
      if (!result) {
        // Only reachable if something removed the session mid-closing-turn.
        notFound(res)
        return
      }
      sendJson(res, 200, result)
      return
    }

    notFound(res)
  }
}

/**
 * Owns the bind decision. A drill holds a live microphone and reads Andre's
 * private story bank, so the host is fixed at `127.0.0.1` here and is not a
 * parameter — a caller-supplied host would let someone bind `0.0.0.0` and
 * expose both to the network. `port` defaults to `0` (an OS-assigned port)
 * so tests can request an ephemeral one; it carries no security weight.
 */
export function startVoiceServer(deps: VoiceServerDeps, port = 0): Promise<Server> {
  const server = createVoiceServer(deps)
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

const WHISPER_BINARY = process.env.WHISPER_BINARY ?? 'whisper-cli'
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? 'models/ggml-large-v3-turbo.bin'

/**
 * Clarify-first coding drills — `VOICE_VAGUE=1 pnpm mock:web`, or the
 * `mock:web:vague` script.
 *
 * Off by default, and it should stay a choice rather than becoming the house
 * style. A precise prompt is the right default for building recall of a pattern;
 * this mode practises the opening instead, which is a different exercise and a
 * worse one to run every time. Set only `1` rather than any non-empty value, so
 * `VOICE_VAGUE=0` means what it looks like it means.
 */
const VOICE_VAGUE = process.env.VOICE_VAGUE === '1'

/**
 * The production `Speaker` for `deps.speaker`: re-reads `local/voice.json`
 * on every sentence rather than baking `audioDevice` in once at startup, so
 * picking a different speaker in the web client (which persists via
 * `POST /api/devices/config`) takes effect on the very next sentence, no
 * restart required. The read is a few bytes off disk — cheap enough to do
 * per sentence.
 *
 */
export function configuredSpeaker(root: string, makeSpeaker: (opts: SayOptions) => Speaker = resolveSpeaker): Speaker {
  // The utterance in flight, so `stop` has something to reach.
  //
  // **This is the whole reason this object cannot be a bare closure over
  // `speak`.** It was one, and the consequence was that `stop` did not exist on
  // the production speaker at all — so `deps.speaker?.stop?.()` in the SSE close
  // handler silently did nothing, and refreshing the page left the interviewer
  // reading its reply to an empty room. That is the exact bug `Speaker.stop`
  // was added to fix, and only the terminal path (which uses `saySpeaker`
  // directly) ever actually had it.
  let current: Speaker | null = null

  return {
    async speak(text: string): Promise<void> {
      const config = readDeviceConfig(root, null)
      // Env beats the file, and the file beats the system default — resolved by
      // the same function `cli.ts` uses, so one variable means one thing
      // whichever front end is running.
      const speaker = makeSpeaker({ audioDevice: config.output, ...resolveSpeech(config) })
      current = speaker
      try {
        await speaker.speak(text)
      } finally {
        if (current === speaker) current = null
      }
    },
    stop(): void {
      current?.stop?.()
      current = null
    },
  }
}

/**
 * Prints each track's backend at boot, and warms ollama if any track uses it.
 *
 * The listing is not decoration: the backend is per track, so a hybrid is the
 * expected arrangement, and a hybrid you cannot see is one you will
 * misattribute a bad drill to. An invalid value throws here — at startup,
 * before a drill — rather than at the first turn.
 *
 * The preload is fire-and-forget. A first ollama request has to pull the model
 * into memory, measured at ~168s for an 18GB model; doing it now means the
 * drill's first turn does not sit in silence for three minutes. It reports
 * rather than throws, because a cold cache is slow and an unstarted server is
 * useless.
 */
function announceBackends(): void {
  const backends = backendSummary()
  for (const [track, backend] of Object.entries(backends)) {
    console.log(`  ${track}: ${describeBackend(backend, modelFor(backend))}`)
  }
  if (Object.values(backends).includes('ollama')) {
    void preloadOllama().then((message) => console.log(`  ${message}`))
  }
}

/**
 * TLS material for the dev server, if it has been generated.
 *
 * Chromium's "localhost counts as a secure context" exemption is not
 * universal across its forks — Arc requires real HTTPS before it will expose
 * `navigator.mediaDevices` at all, so on Arc the drill's microphone request
 * hangs forever over plain HTTP with no prompt and no error. Serving TLS is
 * the only fix.
 *
 * Generated with mkcert so the certificate is trusted by the system CA and
 * the browser raises no warning:
 *
 *   mkdir -p local/certs && cd local/certs
 *   mkcert -cert-file cert.pem -key-file key.pem localhost 127.0.0.1 ::1
 *
 * Lives under `local/` because it is machine-specific and `local/` is
 * gitignored — a private key must never be committed. Absent, the server
 * falls back to HTTP, which is fine in Chrome and Firefox.
 */
function readTlsMaterial(root: string): { cert: Buffer; key: Buffer } | null {
  const certPath = join(root, 'local/certs/cert.pem')
  const keyPath = join(root, 'local/certs/key.pem')
  if (!existsSync(certPath) || !existsSync(keyPath)) return null
  return { cert: readFileSync(certPath), key: readFileSync(keyPath) }
}

function main(): void {
  const port = process.env.PORT ? Number(process.env.PORT) : 4173
  const root = process.cwd()
  const distDir = join(root, 'voice/dist')
  // `pnpm mock:web` builds before it starts this process (see package.json),
  // so a missing dist here means the server was started some other way
  // (directly via `tsx voice/http-server.ts`) without building first — fail
  // with a clear instruction rather than a confusing string of 404s on every
  // asset the page tries to load.
  if (!existsSync(distDir)) {
    console.error(
      `Missing ${distDir} — build the web client first with \`pnpm build:web\`, ` +
        'or just run `pnpm mock:web`, which does that for you.',
    )
    process.exit(1)
  }
  // Fail here, not on the interviewer's first sentence — several minutes into
  // a drill, after a model turn has already been paid for.
  let speechBanner: string
  try {
    speechBanner = checkSpeechEngine()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
  const tls = readTlsMaterial(root)
  const server = createVoiceServer({
    root,
    createTransport: (track) => streamForBackend(track, (line) => console.log(`${track}: ${line}`)),
    transcriber: whisperTranscriber({ binary: WHISPER_BINARY, model: WHISPER_MODEL }),
    tls,
    speaker: configuredSpeaker(root),
    vague: VOICE_VAGUE,
  })
  // Still `127.0.0.1` only — TLS changes the scheme, never the reach. A live
  // microphone and a private story bank have no business on the network.
  server.listen(port, '127.0.0.1', () => {
    const scheme = tls ? 'https' : 'http'
    // `127.0.0.1`, not `localhost`: the listen above binds IPv4 only, and
    // browsers resolve `localhost` to `::1` first — so a `localhost` URL
    // fails to connect in Chrome even though curl silently falls back to
    // IPv4. The certificate covers both names.
    const url = `${scheme}://127.0.0.1:${port}/`
    console.log(`Voice mock drill: ${url}`)
    console.log(`  ${speechBanner}`)
    announceBackends()
    if (!tls) {
      console.log(
        'Serving plain HTTP. Chrome and Firefox treat localhost as secure, but Arc and Safari do not —\n' +
          'they will never prompt for the microphone. To serve HTTPS:\n' +
          '  mkdir -p local/certs && cd local/certs && mkcert -cert-file cert.pem -key-file key.pem localhost 127.0.0.1 ::1',
      )
    }
    // Opened here rather than from `createVoiceServer`, which a dozen tests
    // construct directly. Chrome by name, not the default browser — see
    // open-browser.ts for why that distinction is load-bearing.
    const disabled = openDisabled()
    const plan = openPlan(url, { disabled })
    if (plan) {
      console.log(
        plan.args[0] === '-a'
          ? 'Opening Chrome. Set VOICE_NO_OPEN=1 to stop doing that.'
          : 'Chrome not found — opening your default browser instead. Check the table in AGENTS.md if the ' +
              'microphone is never offered.',
      )
    } else if (disabled) {
      console.log('VOICE_NO_OPEN is set — not opening a browser.')
    }
    openInBrowser(plan)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
