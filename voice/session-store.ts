import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { Interviewer } from './interviewer'
import type { Session } from './session'
import type { Track } from './context'

/**
 * A failed turn's audio, kept around so a retry doesn't have to ask Andre to
 * record again. `path` always lives under this session's `scratchDir`, so
 * `endAndPersist`'s recursive `rmSync` of that directory is sufficient
 * cleanup on every session-exit path — nothing extra to unlink there. `kind`
 * says how far the pipeline got: `'wav'` means transcode already succeeded
 * (a retry can skip straight to transcription), `'webm'` means it didn't (a
 * retry must transcode again). `at` is the *original* turn's elapsed-time
 * stamp — see the comment on `Entry.at` in http-server.ts — preserved across
 * retries so a retry's success doesn't stamp the entry with the (later,
 * retry-time) moment instead of when Andre actually finished speaking.
 */
export interface RetainedAudio {
  path: string
  kind: 'wav' | 'webm'
  at: number
}

/**
 * Which drill a session is running. `finishSession` needs both to name the
 * transcript (`local/mock-...` vs `local/designs/<problem>-live-...`), and the
 * client needs them back on reopen to restore the problem pane and the clock.
 */
export interface Drill {
  track: Track
  /** Required for `design`, absent for `mock` — see `allowedPaths`. */
  problem?: string
  /**
   * Behavioural track only: the competency slug to drill, when one was picked.
   * Absent means the interviewer chooses, which is the default and the mode that
   * still tests recognising the competency behind the phrasing.
   */
  competency?: string
  /** The design track's time budget in ms; absent when the drill is untimed. */
  budgetMs?: number
  /**
   * Coding track only: where the answer is written. `browser` puts a
   * deliberately limited editor on screen; `own` means the candidate edits
   * `solution.ts` in their own editor, which is the mode that keeps real types.
   * Absent means `own` — see `parseDrill` in http-server.ts, the only place
   * this is validated.
   */
  editor?: 'browser' | 'own'
}

export interface StoredSession {
  id: string
  /**
   * Whose session this is, or `null` in local mode where there is only ever one
   * person and no identity to attach.
   *
   * The one-session-at-a-time rule is per person on a deployed instance, and
   * that is not a relaxation — it is the same rule. It always meant "you cannot
   * be in two interviews at once", and the process-wide version of it only
   * happened to be equivalent because there was only ever one candidate.
   */
  userId: string | null
  session: Session
  interviewer: Interviewer
  drill: Drill
  startedAt: Date
  /** This session's temp directory for uploaded/transcoded audio; removed on `remove()`'s caller's cleanup. */
  scratchDir: string
  /** The open SSE response for this session, once a client has connected. */
  sseClient?: ServerResponse
  lastActivity: number
  /** The most recent failed turn's audio, if any — see `RetainedAudio`. At most one at a time. */
  retainedAudio?: RetainedAudio
  /**
   * Highest hint rung reached on a coding drill, 0-4 (0 = no help taken).
   *
   * Server-owned, and that is the point. The rung is the number `/status` uses to
   * tell rust from coverage — "solved at rung 3 six weeks ago is rust, not
   * coverage" — so it is counted from actual requests rather than recalled by the
   * interviewer at the end of a long conversation. It also lets the client show a
   * live count without the interviewer having to report one per turn.
   */
  hintRung: number
}

export interface SessionStore {
  create(
    session: Session,
    interviewer: Interviewer,
    startedAt: Date,
    scratchDir: string,
    drill: Drill,
    userId?: string | null,
  ): StoredSession
  /**
   * By id, without regard to owner.
   *
   * Deliberately global, and safe on its own terms: a session id is a
   * `randomUUID`, so it is not something one person can arrive at by guessing at
   * another's. Ownership is still checked above this, at the routes, because an
   * unguessable id is a reason not to worry and not a reason to skip the check.
   */
  get(id: string): StoredSession | undefined
  remove(id: string): void
  /** True once `userId` has a session live — the web path allows one each at a time. */
  hasActive(userId?: string | null): boolean
  /** The id of that person's one active session, if any. */
  activeId(userId?: string | null): string | undefined
  touch(id: string, now: number): void
  /**
   * Sessions that are **orphaned** — idle past `idleMs` *and* with no browser
   * still attached. Does not remove them.
   *
   * The second half of that is load-bearing, and its absence ended a live drill
   * on 2026-08-12 at the worst possible moment. Only four routes call `touch`
   * (`/turn`, `/turn/retry`, `/hint`, `/tests`), so the one activity a coding
   * drill actually consists of — sitting quietly and writing code — is invisible
   * to this store. Five minutes of that is not an abandoned session, it is the
   * exercise; the drill's own clock allows forty-five of them. A session whose
   * SSE connection is still open has a browser on the other end by definition,
   * and `teardownDisconnectedClient` already ends the ones that genuinely go
   * away, so liveness is the honest test of "orphaned" and elapsed silence is not.
   */
  reapIdle(now: number, idleMs: number): StoredSession[]
}

/**
 * Whether a browser is still attached to this session.
 *
 * `writableEnded` covers the reconnect path, where `/stream` deliberately ends
 * the previous response before installing the new one; `destroyed` covers a
 * socket torn down under us. Either way the object is still referenced by the
 * stored session until something replaces it, so presence alone is not enough
 * to conclude anyone is listening.
 */
function hasLiveClient(stored: StoredSession): boolean {
  const client = stored.sseClient
  return client !== undefined && !client.writableEnded && !client.destroyed
}

export function createSessionStore(
  idFactory: () => string = randomUUID,
  now: () => number = Date.now,
): SessionStore {
  const sessions = new Map<string, StoredSession>()

  return {
    create(session, interviewer, startedAt, scratchDir, drill, userId = null) {
      const stored: StoredSession = {
        id: idFactory(),
        userId,
        session,
        interviewer,
        drill,
        startedAt,
        scratchDir,
        lastActivity: now(),
        hintRung: 0,
      }
      sessions.set(stored.id, stored)
      return stored
    },
    get: (id) => sessions.get(id),
    remove: (id) => {
      sessions.delete(id)
    },
    // Filtered by owner rather than by count. One `Map` with a `userId` field
    // and per-person predicates over it, not one store per person: `get`,
    // `remove`, `touch` and `reapIdle` are all genuinely global — an idle
    // session is idle whoever owns it — and N stores would mean four of the six
    // methods having to search all of them.
    hasActive: (userId = null) => [...sessions.values()].some((s) => s.userId === userId),
    activeId: (userId = null) =>
      [...sessions.values()].find((s) => s.userId === userId)?.id,
    touch(id, now) {
      const stored = sessions.get(id)
      if (stored) stored.lastActivity = now
    },
    reapIdle(now, idleMs) {
      return [...sessions.values()].filter(
        (s) => now - s.lastActivity > idleMs && !hasLiveClient(s),
      )
    },
  }
}
