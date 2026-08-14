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
  track: 'mock' | 'design' | 'coding' | 'coach' | 'debug'
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
  /**
   * Coding track only: where the answer is written. `browser` puts a
   * deliberately limited editor on screen; `own` means the candidate edits
   * `solution.ts` in their own editor, which is the mode that keeps real types
   * and is better for learning a pattern cold. Absent means `own`.
   */
  editor?: 'browser' | 'own'
}

/** The tracks that have a problem to put on screen. */
export type ProblemTrack = 'design' | 'coding' | 'mock' | 'coach' | 'debug'

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
 * A debugging exercise's outcome, from the same `POST /api/session/:id/tests`.
 * Mirrors the server's `DebugVerdict` (voice/debug-tests.ts).
 *
 * Where a coding drill has two kinds of *red* that mean opposite things, this has
 * two kinds of **green** — and the misleading one is the one that looks like
 * success. `symptom-patch` is its own case, never a shade of failure and never a
 * partial pass: it is the finding the exercise exists to produce.
 */
export type DebugVerdict =
  | { kind: 'root-cause' }
  | { kind: 'symptom-patch'; failed: string[] }
  | { kind: 'unfixed'; failed: string[] }
  | { kind: 'errored'; message: string }

/** Either track's outcome. The screen decides which renderer to use, by route. */
export type AnyVerdict = DrillVerdict | DebugVerdict

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
  /**
   * Problem slugs that appear in `local/coached.md`.
   *
   * Not gated behind `?patterns=1` the way the pattern is: pairing is something
   * he chose and sat through, so saying it happened spoils nothing. Optional
   * because a server older than the coaching track does not send it.
   */
  coached?: string[]
}

/** One company that has asked this problem, from `GET /api/problems/coding/detail`. */
export interface ProblemCompany {
  name: string
  confidence: string
}

/**
 * One coding problem's browsing metadata, from `GET /api/problems/coding/detail`.
 *
 * **Never carries a `pattern` field.** See Problems.tsx: this is the default,
 * always-on list, and AGENTS.md's rule ("a permanent problem-to-pattern list
 * would spoil every re-drill at a glance") applies to it exactly as it applies
 * to `HistoryRow` without `?patterns=1`.
 */
export interface ProblemDetail {
  slug: string
  title: string
  difficulty: string
  companies: ProblemCompany[]
}

export interface ProblemsDetailPayload {
  problems: ProblemDetail[]
}

/**
 * One difficulty's tally, from `GET /api/progress`'s `byDifficulty`.
 *
 * Cold and helped are separate fields, never a single `solved`. Same rule as
 * `HistorySummary`/`History.tsx`: a solve that took hints is a different fact
 * from a cold one, and collapsing them here would be the same flattening one
 * level up.
 */
export interface DifficultyProgress {
  difficulty: string
  cold: number
  helped: number
  unsolved: number
  unattempted: number
  total: number
}

/**
 * The overall tally on `GET /api/progress`. Same shape as a `DifficultyProgress`
 * row minus `difficulty` — the server's total across every difficulty.
 */
export interface ProgressSummary {
  cold: number
  helped: number
  unsolved: number
  unattempted: number
  total: number
}

export interface ProgressPayload {
  summary: ProgressSummary
  byDifficulty: DifficultyProgress[]
}

/**
 * One problem inside a pattern's group, from `GET /api/roadmap?study=1`.
 *
 * This is the one payload in the client that is allowed to imply a pattern —
 * the whole point of Study Mode is naming it — which is why the route that
 * reaches it is gated behind an explicit confirmation. See Study.tsx.
 */
export interface RoadmapProblem {
  slug: string
  title: string
  attempted: boolean
  cold: boolean
}

export interface RoadmapPattern {
  pattern: string
  problems: RoadmapProblem[]
}

export interface RoadmapPayload {
  patterns: RoadmapPattern[]
}

/**
 * The worked debrief for one problem, from `GET /api/review/<slug>`.
 *
 * The server 403s this route when there is no logged attempt for the slug —
 * Review.tsx renders that as an explanation, not an error, and the client never
 * offers a link here except from a row that already has one. `row` carries the
 * pattern unconditionally: unlike the history and problems screens, this one is
 * reached only by a deliberate act and its entire purpose is the spoiler.
 */
export interface ReviewPayload {
  answer: string
  readme: string
  attempt: string | null
  row: HistoryRow
}
