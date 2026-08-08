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
  /** Sessions whose lastActivity is more than idleMs behind now. Does not remove them. */
  reapIdle(now: number, idleMs: number): StoredSession[]
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
      return [...sessions.values()].filter((s) => now - s.lastActivity > idleMs)
    },
  }
}
