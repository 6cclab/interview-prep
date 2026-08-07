export type Mode = 'idle' | 'listening-to-interviewer' | 'requesting-mic' | 'recording' | 'ended'

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
