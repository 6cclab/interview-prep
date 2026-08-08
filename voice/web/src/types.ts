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
