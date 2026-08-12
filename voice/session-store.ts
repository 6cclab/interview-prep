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
}

export interface StoredSession {
  id: string
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
  create(session: Session, interviewer: Interviewer, startedAt: Date, scratchDir: string, drill: Drill): StoredSession
  get(id: string): StoredSession | undefined
  remove(id: string): void
  /** True once any session is live — the web path allows exactly one at a time. */
  hasActive(): boolean
  /** The id of the one active session, if any — mirrors `hasActive`'s "at most one" invariant. */
  activeId(): string | undefined
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
    create(session, interviewer, startedAt, scratchDir, drill) {
      const stored: StoredSession = {
        id: idFactory(),
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
    hasActive: () => sessions.size > 0,
    activeId: () => sessions.keys().next().value,
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
