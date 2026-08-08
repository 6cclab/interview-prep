import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { Interviewer } from './interviewer'
import type { Session } from './session'

export interface StoredSession {
  id: string
  session: Session
  interviewer: Interviewer
  startedAt: Date
  /** This session's temp directory for uploaded/transcoded audio; removed on `remove()`'s caller's cleanup. */
  scratchDir: string
  /** The open SSE response for this session, once a client has connected. */
  sseClient?: ServerResponse
  lastActivity: number
}

export interface SessionStore {
  create(session: Session, interviewer: Interviewer, startedAt: Date, scratchDir: string): StoredSession
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
    create(session, interviewer, startedAt, scratchDir) {
      const stored: StoredSession = {
        id: idFactory(),
        session,
        interviewer,
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
