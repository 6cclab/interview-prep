import { describe, it, expect } from 'vitest'
import { saveSolution, runAfterSave } from './useSolution'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
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
