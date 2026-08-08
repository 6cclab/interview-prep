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
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch-1', MOCK)
    expect(stored.id).toBe('id-1')
  })

  it('get() finds a stored session by id', () => {
    const store = createSessionStore(() => 'abc')
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK)
    expect(store.get('abc')).toBe(stored)
  })

  it('get() returns undefined for an unknown id', () => {
    const store = createSessionStore()
    expect(store.get('nope')).toBeUndefined()
  })

  it('reports no active session before any is created', () => {
    expect(createSessionStore().hasActive()).toBe(false)
  })

  it('reports an active session once one exists', () => {
    const store = createSessionStore()
    store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK)
    expect(store.hasActive()).toBe(true)
  })

  it('remove() clears the session so hasActive() goes false again', () => {
    const store = createSessionStore(() => 'abc')
    store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK)
    store.remove('abc')
    expect(store.hasActive()).toBe(false)
    expect(store.get('abc')).toBeUndefined()
  })

  it('touch() updates lastActivity', () => {
    const store = createSessionStore(() => 'abc')
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK)
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
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK)
    expect(stored.lastActivity).toBe(4242)
  })

  it('reapIdle() returns sessions past the idle threshold and nothing else', () => {
    // No pre-emptive touch(): create() itself must land lastActivity on the
    // injected clock for this timing to hold.
    const store = createSessionStore(() => 'abc', () => 1000)
    store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch', MOCK)
    expect(store.reapIdle(1000 + 4_000, 5_000)).toEqual([])
    expect(store.reapIdle(1000 + 6_000, 5_000).map((s) => s.id)).toEqual(['abc'])
  })
})
