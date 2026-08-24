import { describe, it, expect } from 'vitest'
import {
  saveSolution,
  runAfterSave,
  createAutosave,
  overwriteConflict,
  reloadFromServer,
  type SolutionStatus,
} from './useSolution'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// saveSolution has several await hops (fetch, res.json()) between a settle
// and the gate's queued rerun actually calling fetch again; a fixed number of
// `Promise.resolve()` ticks is fragile against that, so flush with a real
// macrotask instead.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('saveSolution', () => {
  it('returns the new version on success', async () => {
    const result = await saveSolution('valid-palindrome', 'x', 'v1', async () =>
      jsonResponse(200, { version: 'v2' }),
    )
    expect(result).toEqual({ kind: 'ok', version: 'v2' })
  })

  // The 409 must surface as its own outcome. Collapsing it into a generic
  // error would let the client retry, and a retry that "wins" is the data
  // loss the guard exists to prevent.
  it('reports a conflict distinctly, carrying the version now on disk', async () => {
    const result = await saveSolution('valid-palindrome', 'x', 'stale', async () =>
      jsonResponse(409, { error: 'changed on disk', version: 'v9' }),
    )
    expect(result).toEqual({ kind: 'stale', version: 'v9' })
  })

  it('reports a transport failure as an error rather than a conflict', async () => {
    const result = await saveSolution('valid-palindrome', 'x', 'v1', async () => {
      throw new Error('network down')
    })
    expect(result.kind).toBe('error')
  })

  it('sends the slug in the path and the version in the body', async () => {
    let seenUrl = ''
    let seenBody: unknown
    await saveSolution('valid-palindrome', 'const x = 1\n', 'v1', async (url, init) => {
      seenUrl = String(url)
      seenBody = JSON.parse(String(init?.body))
      return jsonResponse(200, { version: 'v2' })
    })
    expect(seenUrl).toBe('/api/coding/valid-palindrome/solution')
    expect(seenBody).toEqual({ text: 'const x = 1\n', version: 'v1' })
  })
})

// createAutosave wraps saveSolution with a re-entrancy guard: only one PUT in
// flight at a time, and an edit made while one is in flight is not lost —
// the buffer stays dirty and a follow-up save runs once the first settles.
// Split out of the hook the same way saveSolution and runAfterSave are, so
// the guard is testable without a renderer.
function makeState() {
  const state = {
    text: 'v1-text',
    version: 'v1',
    dirty: true,
    conflicted: false,
    statuses: [] as SolutionStatus[],
  }
  return {
    state,
    accessors: {
      getText: () => state.text,
      setText: (v: string) => { state.text = v },
      getVersion: () => state.version,
      setVersion: (v: string) => { state.version = v },
      isDirty: () => state.dirty,
      setDirty: (v: boolean) => { state.dirty = v },
      setStatus: (s: SolutionStatus) => { state.statuses.push(s) },
      isConflicted: () => state.conflicted,
      setConflicted: (v: boolean) => { state.conflicted = v },
    },
  }
}

describe('createAutosave', () => {
  it('keeps at most one PUT in flight, even when save() is called again before the first resolves', async () => {
    const { state, accessors } = makeState()
    const sent: Array<{ text: string; version: string }> = []
    let concurrentFetches = 0
    let maxConcurrentFetches = 0
    const releasers: Array<(version: string) => void> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      concurrentFetches++
      maxConcurrentFetches = Math.max(maxConcurrentFetches, concurrentFetches)
      sent.push(JSON.parse(String(init?.body)))
      const version = await new Promise<string>((resolve) => releasers.push(resolve))
      concurrentFetches--
      return jsonResponse(200, { version })
    }

    const save = createAutosave('valid-palindrome', accessors, fetchImpl)

    const p1 = save()
    await flush() // let the first PUT dispatch
    // Mirrors what actually causes a second `save()` call in the hook: the
    // debounce effect only schedules a call when `dirty` is true, so a
    // realistic second call implies an edit happened in between.
    state.text = 'v2-text'
    state.dirty = true
    const p2 = save() // fires while the first is still in flight

    expect(sent.length).toBe(1) // the second call must not dispatch yet
    expect(maxConcurrentFetches).toBe(1)

    releasers[0]!('v2')
    expect(await p1).toBe('ok')

    // give the guard a turn to start the queued rerun
    await flush()
    expect(sent.length).toBe(2)

    releasers[1]!('v3')
    expect(await p2).toBe('ok')
    expect(maxConcurrentFetches).toBe(1)
    expect(state.version).toBe('v3')
  })

  it('saves text typed while a save is in flight, once the first save settles', async () => {
    const { state, accessors } = makeState()
    const sent: Array<{ text: string; version: string }> = []
    const releasers: Array<(version: string) => void> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)))
      const version = await new Promise<string>((resolve) => releasers.push(resolve))
      return jsonResponse(200, { version })
    }

    const save = createAutosave('valid-palindrome', accessors, fetchImpl)

    const p1 = save()
    await flush()
    state.text = 'v2-text' // typed while the first PUT is still in flight
    const p2 = save()

    releasers[0]!('v2')
    await p1
    await flush()

    expect(sent[1]).toEqual({ text: 'v2-text', version: 'v2' })
    releasers[1]!('v3')
    await p2
    expect(state.version).toBe('v3')
    expect(state.dirty).toBe(false)
  })

  it('a genuine external 409 still surfaces as conflict and keeps the buffer, without retrying', async () => {
    const { state, accessors } = makeState()
    const fetchImpl: typeof fetch = async () =>
      jsonResponse(409, { error: 'changed on disk', version: 'v9' })

    const save = createAutosave('valid-palindrome', accessors, fetchImpl)

    const outcome = await save()

    expect(outcome).toBe('stale')
    expect(state.statuses.at(-1)).toBe('conflict')
    expect(state.text).toBe('v1-text') // the buffer is never replaced — the original guard, unweakened
    // The version IS refreshed (Finding 1): a permanently-stale stored version is what made every
    // later save 409 forever, blocking Run tests for the rest of the session. Recording the
    // server's current version is what lets an explicit Overwrite ever succeed.
    expect(state.version).toBe('v9')
    expect(state.dirty).toBe(true) // still needs saving; nothing was silently retried
  })

  // Finding 1: a conflict used to be a dead end — every later autosave resent the same
  // now-permanently-stale version and 409'd forever, so `Run tests` never saw 'ok' again for the
  // rest of the session. Autosave must instead go quiet once conflicted, until the user resolves
  // it explicitly.
  it('does not fire on its own once conflicted — no further network calls until resolved', async () => {
    const { state, accessors } = makeState()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls++
      return jsonResponse(409, { error: 'changed on disk', version: 'v9' })
    }
    const save = createAutosave('valid-palindrome', accessors, fetchImpl)

    await save() // first attempt: hits the network, lands in conflict
    expect(calls).toBe(1)

    // Simulate more typing and another debounce tick, exactly what used to 409 forever.
    state.text = 'v2-text'
    state.dirty = true
    const outcome = await save()

    expect(calls).toBe(1) // suspended — no second request was ever sent
    expect(outcome).toBe('stale')
    expect(state.dirty).toBe(true) // the new text is still waiting, not silently dropped
  })

  it('an explicit overwrite succeeds using the version the 409 refreshed', async () => {
    const { state, accessors } = makeState()
    const sent: Array<{ text: string; version: string }> = []
    let call = 0
    const fetchImpl: typeof fetch = async (_url, init) => {
      call++
      sent.push(JSON.parse(String(init?.body)))
      if (call === 1) return jsonResponse(409, { error: 'changed on disk', version: 'v9' })
      return jsonResponse(200, { version: 'v10' })
    }
    const save = createAutosave('valid-palindrome', accessors, fetchImpl)

    await save() // lands in conflict, version refreshed to v9
    expect(state.version).toBe('v9')

    const outcome = await overwriteConflict('valid-palindrome', accessors, fetchImpl)

    expect(outcome).toBe('ok')
    expect(sent[1]).toEqual({ text: 'v1-text', version: 'v9' }) // sent the refreshed version, not the stale one
    expect(state.version).toBe('v10')
    expect(state.conflicted).toBe(false) // resolved — autosave can resume
    expect(state.dirty).toBe(false)
    expect(state.statuses.at(-1)).toBe('idle')
  })

  it('reload replaces the buffer with the server copy and clears the conflict', async () => {
    const { state, accessors } = makeState()
    state.conflicted = true
    state.version = 'v9'
    let seenUrl = ''
    const fetchImpl: typeof fetch = async (url) => {
      seenUrl = String(url)
      return jsonResponse(200, { text: 'server-text', version: 'v9' })
    }

    const outcome = await reloadFromServer('valid-palindrome', accessors, fetchImpl)

    expect(outcome).toBe('ok')
    expect(seenUrl).toBe('/api/coding/valid-palindrome/solution')
    expect(state.text).toBe('server-text') // local edits discarded, deliberately
    expect(state.version).toBe('v9')
    expect(state.conflicted).toBe(false)
    expect(state.dirty).toBe(false)
    expect(state.statuses.at(-1)).toBe('idle')
  })
})

describe('runAfterSave', () => {
  it('saves before running, in that order', async () => {
    const order: string[] = []
    await runAfterSave(
      'browser',
      async () => { order.push('save'); return 'ok' },
      async () => { order.push('run') },
    )
    expect(order).toEqual(['save', 'run'])
  })

  it('does not run when the save conflicted', async () => {
    let ran = false
    const result = await runAfterSave('browser', async () => 'stale', async () => { ran = true })
    expect(result).toBe('blocked')
    expect(ran).toBe(false)
  })

  it('does not run when the save errored', async () => {
    let ran = false
    const result = await runAfterSave('browser', async () => 'error', async () => { ran = true })
    expect(result).toBe('blocked')
    expect(ran).toBe(false)
  })

  it('runs without saving in own-editor mode', async () => {
    let saved = false
    let ran = false
    await runAfterSave('own', async () => { saved = true; return 'ok' }, async () => { ran = true })
    expect(saved).toBe(false)
    expect(ran).toBe(true)
  })
})
