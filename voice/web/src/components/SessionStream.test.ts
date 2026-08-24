import { describe, it, expect } from 'vitest'
import { drillVerdictKind, debugVerdictKind, passFooter, costLabel, costWidths } from './SessionStream'

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

/**
 * The two bars. Both numbers are real; these pin how they are drawn.
 */
describe('costLabel', () => {
  it('uses milliseconds below a second, where seconds would round to nothing', () => {
    expect(costLabel(410)).toBe('410ms')
    expect(costLabel(999)).toBe('999ms')
  })

  it('uses seconds above one, with enough precision to be worth reading', () => {
    expect(costLabel(2000)).toBe('2.00s')
    expect(costLabel(41203.482)).toBe('41.2s')
  })
})

describe('costWidths', () => {
  it('draws the overrun proportionally to how far past budget it is', () => {
    const twice = costWidths({ actualMs: 4000, budgetMs: 2000 })
    const fourTimes = costWidths({ actualMs: 8000, budgetMs: 2000 })
    expect(fourTimes.actual).toBeGreaterThan(twice.actual)
    expect(twice.actual).toBeGreaterThan(twice.budget)
  })

  /**
   * A 300x overrun would otherwise render a bar three screens wide, losing the
   * budget reference the comparison exists to make. Past the cap the number
   * carries the magnitude.
   */
  it('caps a runaway overrun rather than drawing off the screen', () => {
    const wild = costWidths({ actualMs: 600_000, budgetMs: 2000 })
    expect(wild.actual).toBeLessThanOrEqual(100)
  })

  /**
   * The cap must not bite on ordinary results, or every overrun draws the same
   * full-width bar and the comparison says nothing. Both of these are real:
   * 20.6x is the handoff's own worked example, and 8.3x is min-eating-speed's
   * brute force measured end to end through `runDrillTests`.
   */
  it.each([
    ['the handoff’s worked example, 20.6x', 41_200, 2000],
    ['a measured brute force, 8.3x', 41_374, 5000],
  ])('draws %s proportionally rather than capped', (_name, actualMs, budgetMs) => {
    expect(costWidths({ actualMs, budgetMs }).actual).toBeLessThan(100)
  })

  it('never draws the overrun shorter than the budget it exceeded', () => {
    // Only reachable from a hand-forged verdict, but a "Yours" bar drawn
    // shorter than "Budget" would state the opposite of the verdict's own head.
    const odd = costWidths({ actualMs: 1, budgetMs: 5000 })
    expect(odd.actual).toBeGreaterThanOrEqual(odd.budget)
  })
})
