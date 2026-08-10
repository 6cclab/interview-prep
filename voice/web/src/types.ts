export type Mode =
  | 'idle'
  | 'listening-to-interviewer'
  | 'requesting-mic'
  | 'recording'
  /**
   * The answer has been recorded and is being uploaded and transcribed.
   *
   * Its own mode because `recording` used to cover it: `stopAndSubmit` stopped
   * the recorder, set a status string, and left the mode at `recording` until
   * the fetch resolved — so for the several seconds transcription takes, the
   * primary control still read "End answer" and was still live, over a frozen
   * timer.
   */
  | 'transcribing'
  | 'ended'

/**
 * What the screen is doing. Derived from `Mode` plus `interviewerSpeaking` and
 * `awaitingInterviewer` in `derivePhase` (see phase.ts).
 *
 * Started as the design handoff's five states. Two more were added because the
 * five silently covered waits: `listening-to-interviewer` meant both "the
 * interviewer is generating a reply" and "your turn", so the primary control
 * invited an answer to a question that had not been asked yet — and the same
 * state was entered the moment a session started, before the opening question
 * existed. A wait the UI does not name is a wait the user reads as a hang.
 */
export type Phase =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'recording'
  /** Uploading and transcribing the answer just given. */
  | 'transcribing'
  /** Transcribed; the interviewer is generating a reply but has not spoken yet. */
  | 'thinking'
  | 'speaking'
  | 'ended'

/**
 * The four first-class error banners from the handoff. Each maps to a real
 * failure path in useVoiceSession.ts — see `deriveErrorKind` (App.tsx) and
 * the comments on `micFailureKind`/`transcriptFailed` in useVoiceSession.ts.
 */
export type ErrorKind = 'denied' | 'nodevice' | 'transcript' | 'stuck'

/**
 * Mirrors `voice/transcript.ts`'s `Entry` shape as it arrives over the
 * `entry` SSE event — deliberately not importing that type from the server
 * package (the client has no build-time dependency on server code). Kept in
 * sync by hand; `voice/http-server.test.ts` and `spoiler-gate.test.ts` pin
 * the wire shape on the server side.
 */
export interface Entry {
  speaker: 'andre' | 'interviewer'
  text: string
  at: number
}

/** A microphone as reported by `navigator.mediaDevices.enumerateDevices()`. */
export interface MicDevice {
  deviceId: string
  label: string
}

/** A speaker as reported by the server's `GET /api/devices/output` (see `voice/devices.ts`). */
export interface OutputDevice {
  id: string
  name: string
}

/**
 * The session a `POST /api/session` 409 refused to start alongside, from that
 * 409's body. `startedAt` is an ISO string, or `null` if the server did not
 * report one — the banner names the time when it can and stays silent about it
 * when it cannot, rather than inventing one.
 */
export interface StuckSession {
  id: string
  startedAt: string | null
}

/** Which drill a session runs. Mirrors the server's `Drill` (voice/session-store.ts). */
export interface Drill {
  track: 'mock' | 'design' | 'coding'
  /** Required for `design` and `coding`, absent for `mock`. */
  problem?: string
  /**
   * Behavioural track only: one competency slug to stay on. Absent means the
   * interviewer chooses, which is the default — being told the competency up
   * front removes the recognition `behavioral/questions.md` opens by teaching.
   */
  competency?: string
  /** A timed drill's budget in ms; absent when the drill is untimed. */
  budgetMs?: number
}

/** The tracks that have a problem to put on screen. */
export type ProblemTrack = 'design' | 'coding' | 'mock'

/** A problem and its prompt, from `GET /api/problems/:problem?track=`. */
export interface ProblemStatement {
  problem: string
  prompt: string
}

/**
 * A drill suite's outcome, from `POST /api/session/:id/tests`. Mirrors the
 * server's `DrillVerdict` (voice/drill-tests.ts).
 *
 * The two reds are separate cases because `drill.md` insists they mean opposite
 * things: `correctness-red` is a wrong answer, `cost-red` is a *right* answer
 * that costs too much — a working brute force, which is a legitimate checkpoint.
 * Collapsing them into "failed" is the specific wrong lesson the drill exists to
 * prevent, so the client renders them differently too.
 */
export type DrillVerdict =
  | { kind: 'green' }
  | { kind: 'correctness-red'; failed: string[] }
  | { kind: 'cost-red'; failed: string[] }
  | { kind: 'errored'; message: string }

/**
 * One past drill, from `GET /api/history` (server: `voice/drill-log.ts`).
 *
 * `pattern` is optional because the server withholds it unless `?patterns=1` is
 * asked for — a pattern is the answer to its problem, and this screen is read
 * between drills. See the route's comment in http-server.ts.
 */
export interface HistoryRow {
  date: string
  problem: string
  pattern?: string
  solved: boolean
  /** Highest hint rung reached, 0-4. 0 is a cold solve. */
  hints: number
  elapsedMs: number
  note: string
}

export interface HistorySummary {
  attempts: number
  solved: number
  cold: number
  problems: number
  medianSolvedMs: number | null
}

export interface HistoryPayload {
  summary: HistorySummary
  rows: HistoryRow[]
}
