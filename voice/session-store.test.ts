import { describe, expect, it } from 'vitest'
import { createSessionStore, type Drill } from './session-store'
import type { Interviewer } from './interviewer'
import type { Session } from './session'

/** Every test here is about store bookkeeping, not which drill is running. */
const MOCK: Drill = { track: 'mock' }

function fakeSession(): Session {
  return {
    begin: async function* () {},
    submitTurn: async function* () {},
    interject: async function* () {},
    entries: () => [],
    endedEarly: () => undefined,
    reportFailure: () => {},
  }
}

const fakeInterviewer: Interviewer = { turn: async function* () {}, lastRaw: () => '' }

describe('createSessionStore', () => {
  it('assigns ids from the injected factory', () => {
    let n = 0
    const store = createSessionStore(() => `id-${++n}`)
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch-1', MOCK, null)
    expect(stored.id).toBe('id-1')
  })

  it('get() finds a stored session by id', () => {
    const store = createSessionStore(() => 'abc')
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK, null)
    expect(store.get('abc')).toBe(stored)
  })

  it('get() returns undefined for an unknown id', () => {
    const store = createSessionStore()
    expect(store.get('nope')).toBeUndefined()
  })

  it('reports no active session before any is created', () => {
    expect(createSessionStore().hasActive(null)).toBe(false)
  })

  it('reports an active session once one exists', () => {
    const store = createSessionStore()
    store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK, null)
    expect(store.hasActive(null)).toBe(true)
  })

  it('remove() clears the session so hasActive() goes false again', () => {
    const store = createSessionStore(() => 'abc')
    store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK, null)
    store.remove('abc')
    expect(store.hasActive(null)).toBe(false)
    expect(store.get('abc')).toBeUndefined()
  })

  // The one-at-a-time rule was a property of the process because the process
  // was one person's. On a shared instance that same rule means the first
  // person to start a drill locks everyone else out, and the 409 they get
  // reports someone else's session as their own to recover.
  describe('one session at a time, per person', () => {
    it('does not report another user\'s session as this user\'s', () => {
      const store = createSessionStore()
      store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK, 'ak-alice')
      expect(store.hasActive('ak-alice')).toBe(true)
      expect(store.hasActive('ak-bob')).toBe(false)
    })

    it('gives each user their own session id to recover', () => {
      let n = 0
      const store = createSessionStore(() => `id-${++n}`)
      store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK, 'ak-alice')
      store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK, 'ak-bob')
      expect(store.activeId('ak-alice')).toBe('id-1')
      expect(store.activeId('ak-bob')).toBe('id-2')
    })

    // Local mode is the null user, the same sentinel every other per-user path
    // uses. Null rather than a `'local'` string so it can never collide with a
    // uid an identity provider actually issues.
    it('keeps the local instance a single session, as it is today', () => {
      const store = createSessionStore()
      expect(store.hasActive(null)).toBe(false)
      store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK, null)
      expect(store.hasActive(null)).toBe(true)
    })
  })

  it('touch() updates lastActivity', () => {
    const store = createSessionStore(() => 'abc')
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK, null)
    store.touch('abc', 9999)
    expect(stored.lastActivity).toBe(9999)
  })

  // Regression for a bug where create() stamped lastActivity with the real
  // wall clock instead of the store's own injected clock: the idle reaper and
  // every other read of lastActivity go through the injected `now`, so a
  // fresh session's lastActivity landing on a different timeline than that
  // clock throws off idle-reap timing from the moment the session is created.
  // This must not call touch() first — that would paper over exactly the bug
  // being guarded against.
  it('create() stamps lastActivity from the injected clock, not the wall clock', () => {
    const store = createSessionStore(() => 'abc', () => 4242)
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK, null)
    expect(stored.lastActivity).toBe(4242)
  })

  it('reapIdle() returns sessions past the idle threshold and nothing else', () => {
    // No pre-emptive touch(): create() itself must land lastActivity on the
    // injected clock for this timing to hold.
    const store = createSessionStore(() => 'abc', () => 1000)
    store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK, null)
    expect(store.reapIdle(1000 + 4_000, 5_000)).toEqual([])
    expect(store.reapIdle(1000 + 6_000, 5_000).map((s) => s.id)).toEqual(['abc'])
  })

  /**
   * The regression that ended a live `lru-cache` drill on 2026-08-12, five
   * minutes after the interviewer said "go ahead and write it".
   *
   * Only `/turn`, `/turn/retry`, `/hint` and `/tests` call `touch`, so writing
   * code — the entire point of the exercise, and something the drill's own
   * 45-minute clock budgets for — registers as no activity at all. Silence is
   * therefore not evidence of abandonment. An open SSE response is evidence of
   * the opposite, and that is what the reaper now requires.
   */
  describe('reapIdle() and a browser that is still attached', () => {
    function storeWithIdleSession() {
      const store = createSessionStore(() => 'abc', () => 1000)
      const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK, null)
      return { store, stored, wellPastIdle: 1000 + 60_000 }
    }

    it('spares a long-silent session whose SSE connection is still open', () => {
      const { store, stored, wellPastIdle } = storeWithIdleSession()
      stored.sseClient = { writableEnded: false, destroyed: false } as never
      expect(store.reapIdle(wellPastIdle, 5_000)).toEqual([])
    })

    it('still reaps a session that never had a client', () => {
      const { store, wellPastIdle } = storeWithIdleSession()
      expect(store.reapIdle(wellPastIdle, 5_000).map((s) => s.id)).toEqual(['abc'])
    })

    // The reconnect path in `/stream` ends the previous response and leaves the
    // object in place until the new one replaces it, so a stale `sseClient` must
    // not read as a live browser.
    it('still reaps a session whose client response has ended', () => {
      const { store, stored, wellPastIdle } = storeWithIdleSession()
      stored.sseClient = { writableEnded: true, destroyed: false } as never
      expect(store.reapIdle(wellPastIdle, 5_000).map((s) => s.id)).toEqual(['abc'])
    })

    it('still reaps a session whose client socket was destroyed', () => {
      const { store, stored, wellPastIdle } = storeWithIdleSession()
      stored.sseClient = { writableEnded: false, destroyed: true } as never
      expect(store.reapIdle(wellPastIdle, 5_000).map((s) => s.id)).toEqual(['abc'])
    })

    // Liveness spares an *idle* session; it does not make one immortal, and it
    // must not change behaviour for a session that is not idle in the first place.
    it('does not reap a live-client session that is also inside the threshold', () => {
      const { store, stored } = storeWithIdleSession()
      stored.sseClient = { writableEnded: false, destroyed: false } as never
      expect(store.reapIdle(1000 + 1_000, 5_000)).toEqual([])
    })
  })
})
