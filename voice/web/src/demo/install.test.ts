import { describe, expect, it } from 'vitest'
import { demoResponse } from './install'
import { DEMO_HISTORY_ROWS, DEMO_SUMMARY } from './fixtures'

const body = async (res: Response | null): Promise<Record<string, unknown>> => {
  if (res === null) throw new Error('expected the demo to answer this route')
  return (await res.json()) as Record<string, unknown>
}

describe('the demo backend', () => {
  it('answers the browsing routes the screens actually call', async () => {
    for (const path of ['/api/instance', '/api/problems/coding/detail', '/api/progress', '/api/rust']) {
      expect(demoResponse(path, '')?.status).toBe(200)
    }
  })

  // The worked answers are the answer key to every problem in the repo. They
  // are not gated in this build, they are absent from it.
  it('has no worked answers to serve at all', async () => {
    expect(demoResponse('/api/review/two-sum-sorted', '')?.status).toBe(501)
  })

  // A demo that fell through to a real origin for anything it did not
  // recognise would be the leak this whole build exists to prevent.
  it('refuses an api route it does not know rather than passing it on', () => {
    expect(demoResponse('/api/session/abc/stream', '')?.status).toBe(501)
  })

  it('leaves non-api requests to the real fetch', () => {
    expect(demoResponse('/assets/index.js', '')).toBeNull()
  })

  // The same wire-level gate the real server has, reproduced rather than
  // simplified away — a visitor should see the tool behave as it behaves.
  it('withholds the pattern unless it is asked for, exactly as the server does', async () => {
    const withheld = await body(demoResponse('/api/history', ''))
    expect((withheld.rows as { pattern?: string }[]).every((r) => r.pattern === undefined)).toBe(true)
  })

  it('400s the roadmap without study mode', () => {
    expect(demoResponse('/api/roadmap', '')?.status).toBe(400)
    expect(demoResponse('/api/roadmap', '?study=1')?.status).toBe(200)
  })

  it('never names the pattern of a problem the demo has not attempted', async () => {
    const roadmap = await body(demoResponse('/api/roadmap', '?study=1'))
    const groups = roadmap.patterns as { pattern: string | null; problems: { attempted: boolean }[] }[]
    for (const group of groups) {
      if (group.pattern !== null) {
        expect(group.problems.every((p) => p.attempted)).toBe(true)
      }
    }
  })

  // The one thing the demo exists to show off is the distinction the tool
  // refuses to flatten, so the fixture must not flatten it either.
  it('reports cold and helped as separate figures', () => {
    expect(DEMO_SUMMARY.cold + DEMO_SUMMARY.helped).toBe(DEMO_SUMMARY.solved)
    expect(DEMO_SUMMARY.cold).toBeGreaterThan(0)
    expect(DEMO_SUMMARY.helped).toBeGreaterThan(0)
  })

  it('invents its history rather than shipping anyone\'s', () => {
    // Every row names a problem from the fixture list and a date in the
    // fixture's own range. Nothing here is read from local/ at any point —
    // this asserts the shape of that promise, and the module has no file
    // access to break it with.
    expect(DEMO_HISTORY_ROWS.length).toBeGreaterThan(0)
    expect(DEMO_HISTORY_ROWS.every((r) => /^2026-0[78]-\d\d$/.test(r.date))).toBe(true)
  })
})
