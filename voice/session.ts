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
  /**
   * Feed a transcribed turn; yields the interviewer's reply as speakable
   * sentences. `at` is the moment Andre's turn actually ended — e.g. when a
   * caller stopped the recording — so it stays accurate even when the caller
   * awaits a slow transcription (or a separate HTTP request) before calling
   * this. Required, not defaulted: a caller that doesn't have this moment on
   * hand yet has no business calling `submitTurn` — a quiet `now()` fallback
   * is exactly how transcription latency leaked into the pacing analytics
   * before.
   */
  submitTurn(said: string, at: number): AsyncIterable<string>
  /** The transcript so far. */
  entries(): Entry[]
  /** Set once a turn has failed; the message named in the synthetic entry. */
  endedEarly(): string | undefined
  /**
   * Record a failure that happened before any text existed to feed
   * `submitTurn` — a failed audio transcode or transcription. Produces the
   * same synthetic entry and marker `submitTurn`'s own catch path does. `at`
   * is the moment the failure actually occurred — required, not defaulted,
   * so a caller can't accidentally let the failed operation's own latency
   * leak into the marker's timestamp.
   */
  reportFailure(message: string, at: number): void
}

export interface CreateSessionOptions {
  interviewer: Interviewer
  /** Milliseconds since the session started. */
  now(): number
  /**
   * Optional per-turn note the interviewer sees, prepended to what it is fed —
   * and deliberately **never** part of the transcript `Entry`.
   *
   * The design track needs this: `design.md` tells the interviewer to warn once
   * around the ten-minutes-left mark and to stop at time, but a language model
   * has no clock, so without being told the remaining time on each turn those
   * instructions are unfollowable. Keeping the note out of the entry is the
   * point — the saved transcript is a record of what was *said*, and a
   * scaffolding line Andre never heard has no business in it.
   */
  turnCue?(): string | undefined
}

export function createSession(opts: CreateSessionOptions): Session {
  const entries: Entry[] = []
  let earlyMarker: string | undefined

  function reportFailure(message: string, at: number): void {
    entries.push({ speaker: 'interviewer', text: `[Session ended early — ${message}]`, at })
    earlyMarker = message
    console.error(`Voice session ended early: ${message}`)
  }

  async function* runInterviewerTurn(said: string): AsyncIterable<string> {
    const at = opts.now()
    const spoken: string[] = []
    // The cue is sampled here, not at entry-push time, so it reflects the clock
    // at the moment this turn actually reached the interviewer.
    const cue = opts.turnCue?.()
    const fed = cue ? `${cue}\n\n${said}` : said
    try {
      for await (const sentence of opts.interviewer.turn(fed)) {
        spoken.push(sentence)
        yield sentence
      }
    } catch (error) {
      // Reuse the turn-start timestamp, not a fresh sample — the failing
      // stream may have run for a while before throwing, and that latency
      // must not leak into the marker's `at`.
      reportFailure(errorMessage(error), at)
      return
    }
    entries.push({ speaker: 'interviewer', text: spoken.join(' '), at })
  }

  return {
    begin(): AsyncIterable<string> {
      return runInterviewerTurn(OPENING)
    },
    submitTurn(said: string, at: number): AsyncIterable<string> {
      entries.push({ speaker: 'andre', text: said, at })
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
  // The path written may differ from the one asked for — `writeSession` will not
  // overwrite an existing transcript — so report back what it actually used.
  const relPath = writeSession(
    opts.root,
    sessionPath(opts.track, opts.startedAt, opts.problem),
    formatSession(session.entries(), opts.startedAt),
  )

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
  /** Passed straight through to `createSession` — see `CreateSessionOptions.turnCue`. */
  turnCue?(): string | undefined
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
  const session = createSession({ interviewer: deps.interviewer, now: deps.now, turnCue: deps.turnCue })

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
      // No earlier accurate timestamp exists here — the recording itself
      // never successfully stopped — so sampling now is the correct moment,
      // not a fallback.
      session.reportFailure(`recording failed: ${errorMessage(error)}`, deps.now())
      return outcomeOf(session)
    }
    if (decision === 'end') return outcomeOf(session)

    // Sample the clock the moment recording stopped — i.e. when Andre
    // actually finished speaking — not after transcription, whose latency
    // (real seconds, for whisper.cpp) would otherwise leak into the
    // transcript's pacing analytics.
    const stoppedAt = deps.now()

    let utteranceText: string
    try {
      const utterance = await deps.transcriber.transcribe(wavPath)
      utteranceText = utterance.text
    } catch (error) {
      // Reuse the pre-transcribe timestamp, not a fresh sample — whisper's
      // latency on the failed attempt must not leak into the marker's `at`.
      session.reportFailure(`transcription failed: ${errorMessage(error)}`, stoppedAt)
      return outcomeOf(session)
    }

    for await (const sentence of session.submitTurn(utteranceText, stoppedAt)) {
      await deps.speaker.speak(sentence)
    }
    if (session.endedEarly()) return outcomeOf(session)
  }
}
