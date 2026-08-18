import { describe, expect, it } from 'vitest'
import { endOutcome } from './end-outcome'

/**
 * "End session" has to actually end the session, including when the server no
 * longer has one.
 *
 * A 200 is not the end of it: the screen leaves the drill on the `ended` SSE
 * event, not on this response. So every status has to say which of those two
 * things happens next, and the case that was missing is a 404 — the session was
 * already persisted and removed, so the event is never coming and waiting for it
 * strands the screen on a drill that is over.
 */
describe('endOutcome', () => {
  it('waits for the server to say so when the request was accepted', () => {
    expect(endOutcome(200)).toBe('awaiting-server')
  })

  /**
   * The transcript is already on disk — `endAndPersist` removes the session only
   * after writing it. Nothing is lost by leaving, and there is nothing left to
   * wait for.
   */
  it('ends here when the server no longer has the session', () => {
    expect(endOutcome(404)).toBe('already-saved')
  })

  /**
   * Anything else means this press ended nothing, so the button has to come back
   * rather than the screen moving on from a session that is still open.
   */
  it.each([409, 500, 502, 400])('leaves the session open on a %i', (status) => {
    expect(endOutcome(status)).toBe('failed')
  })

  // A network error has no status at all, and it is the same situation as a 500:
  // nothing was ended, so nothing should move.
  it('treats an unreachable server as a failure, not an ending', () => {
    expect(endOutcome(null)).toBe('failed')
  })
})
