export type Mode = 'idle' | 'listening-to-interviewer' | 'requesting-mic' | 'recording' | 'ended'

/**
 * The design handoff's five-state model. Derived from `Mode` plus
 * `interviewerSpeaking` in `derivePhase` (App.tsx) — `listening-to-interviewer`
 * conflates the handoff's `ready` and `speaking`, and the hook already tracks
 * `interviewerSpeaking` separately, so splitting on that is enough; no new
 * hook state was needed for this.
 */
export type Phase = 'idle' | 'requesting' | 'ready' | 'recording' | 'speaking' | 'ended'

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
  /** A timed drill's budget in ms; absent when the drill is untimed. */
  budgetMs?: number
}

/** The tracks that have a problem to put on screen. */
export type ProblemTrack = 'design' | 'coding'

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
