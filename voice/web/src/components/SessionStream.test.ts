import { describe, it, expect } from 'vitest'
import { drillVerdictKind, debugVerdictKind, passFooter } from './SessionStream'

/**
 * The verdict mapping is the one piece of this screen that can teach the wrong
 * lesson, so it gets pinned rather than trusted to review.
 *
 * `drill.md`'s cardinal sin is treating a working-but-expensive answer as a
 * failure. `cost-red` is a *right* answer — a brute force that passes
 * correctness and blows the budget — and it is a legitimate checkpoint on the
 * way to the real solution. If it ever renders in the same treatment as
 * `correctness-red`, the screen is saying "you got it wrong" about an answer
 * that is right, which is exactly the confusion the two-verdict split exists to
 * prevent.
 */
describe('drillVerdictKind', () => {
  it('gives a wrong answer the red treatment', () => {
    expect(drillVerdictKind({ kind: 'correctness-red', failed: ['firstUniqChar — correctness'] })).toBe('wrong')
  })

  it('does NOT give a right-but-expensive answer the red treatment', () => {
    const kind = drillVerdictKind({ kind: 'cost-red', failed: ['firstUniqChar — scale'] })
    expect(kind).toBe('over-budget')
    expect(kind).not.toBe('wrong')
  })

  it('separates the two reds', () => {
    const wrong = drillVerdictKind({ kind: 'correctness-red', failed: ['a'] })
    const expensive = drillVerdictKind({ kind: 'cost-red', failed: ['a'] })
    expect(wrong).not.toBe(expensive)
  })

  it('maps green and errored', () => {
    expect(drillVerdictKind({ kind: 'green' })).toBe('pass')
    expect(drillVerdictKind({ kind: 'errored', message: 'SyntaxError' })).toBe('errored')
  })
})

/**
 * Debugging's trap is the mirror image: two kinds of *green*, and the flattering
 * one is the wrong one. A symptom patch must not render as a pass — the reported
 * symptom is green while the invariant is not, and congratulating that is what
 * `debug.md` says never to do.
 */
describe('debugVerdictKind', () => {
  it('does NOT give a symptom patch the pass treatment', () => {
    const kind = debugVerdictKind({ kind: 'symptom-patch', failed: ['invariant'] })
    expect(kind).toBe('over-budget')
    expect(kind).not.toBe('pass')
  })

  it('reserves the pass treatment for an actual root-cause fix', () => {
    expect(debugVerdictKind({ kind: 'root-cause' })).toBe('pass')
  })

  it('a still-reproducing bug is wrong, not merely incomplete', () => {
    expect(debugVerdictKind({ kind: 'unfixed', failed: ['repro'] })).toBe('wrong')
  })

  it('separates a symptom patch from both a pass and a failure', () => {
    const patch = debugVerdictKind({ kind: 'symptom-patch', failed: ['x'] })
    expect(patch).not.toBe(debugVerdictKind({ kind: 'root-cause' }))
    expect(patch).not.toBe(debugVerdictKind({ kind: 'unfixed', failed: ['x'] }))
  })
})

/**
 * A green with no price on it is the flattening `local/drill-log.md`'s preamble
 * warns about — "a solve that took four hints is a different fact from a cold
 * solve". The footer is where the verdict itself carries that fact.
 */
describe('passFooter', () => {
  it('says a cold solve was cold', () => {
    expect(passFooter(0)).toBe('Cold · no help taken')
  })

  it('never claims a helped solve was cold', () => {
    for (const rung of [1, 2, 3, 4]) {
      expect(passFooter(rung)).not.toContain('Cold')
      expect(passFooter(rung)).toContain(`Rung ${rung} of 4`)
    }
  })
})
