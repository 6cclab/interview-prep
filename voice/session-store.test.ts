import { describe, expect, it } from 'vitest'
import { createSessionStore } from './session-store'
import type { Interviewer } from './interviewer'
import type { Session } from './session'

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
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch-1')
    expect(stored.id).toBe('id-1')
  })

  it('get() finds a stored session by id', () => {
    const store = createSessionStore(() => 'abc')
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch')
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
    store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch')
    expect(store.hasActive()).toBe(true)
  })

  it('remove() clears the session so hasActive() goes false again', () => {
    const store = createSessionStore(() => 'abc')
    store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch')
    store.remove('abc')
    expect(store.hasActive()).toBe(false)
    expect(store.get('abc')).toBeUndefined()
  })

  it('touch() updates lastActivity', () => {
    const store = createSessionStore(() => 'abc')
    const stored = store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch')
    store.touch('abc', 9999)
    expect(stored.lastActivity).toBe(9999)
  })

  it('reapIdle() returns sessions past the idle threshold and nothing else', () => {
    const store = createSessionStore(() => 'abc')
    store.create(fakeSession(), fakeInterviewer, new Date(), '/tmp/scratch')
    store.touch('abc', 1000)
    expect(store.reapIdle(1000 + 4_000, 5_000)).toEqual([])
    expect(store.reapIdle(1000 + 6_000, 5_000).map((s) => s.id)).toEqual(['abc'])
  })
})
