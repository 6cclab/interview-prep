/**
 * What a `POST /api/session/:id/end` response means for the screen.
 *
 * Pressing "End session" does not itself end anything on screen: the drill is
 * left on the `ended` SSE event, which arrives after the server has written the
 * transcript. So the response only decides which of two things happens next —
 * wait for that event, or do not.
 *
 * A 404 is the case that had no answer. The session is gone from the store,
 * which means `endAndPersist` already ran and already wrote the transcript, so
 * the event is never coming. Waiting for it left the drill on screen with a
 * button that explained itself politely and never got anywhere — which is what
 * "when time ends you cannot end a session" is: the session is reaped or its
 * stream has dropped, and every press after that is a 404.
 */
export type EndOutcome =
  /** Accepted. The `ended` SSE event will move the screen. */
  | 'awaiting-server'
  /** Gone from the server, and only ever removed after being persisted. */
  | 'already-saved'
  /** Nothing was ended, so nothing should move and the button comes back. */
  | 'failed'

/** `status` is null where the request never got a response at all. */
export function endOutcome(status: number | null): EndOutcome {
  if (status === 200) return 'awaiting-server'
  if (status === 404) return 'already-saved'
  return 'failed'
}
