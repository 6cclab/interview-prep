import { describe, expect, it } from 'vitest'
import { failedTestName, groupFailures } from './drill-verdict'

/**
 * The display name, taken apart again.
 *
 * `failedTestName` joins with `' > '` and its comment says the delimiter is
 * ours; `groupFailures` is the inverse and lives beside it so there is still
 * exactly one place that knows the string. A component splitting on its own
 * guess would go on matching a join it cannot see.
 */
describe('groupFailures', () => {
  it('shows a suite once instead of on every row', () => {
    expect(
      groupFailures(['sums — correctness > adds', 'sums — correctness > handles zero']),
    ).toEqual([{ suite: 'sums — correctness', titles: ['adds', 'handles zero'] }])
  })

  it('keeps distinct suites apart, in the order they failed', () => {
    expect(groupFailures(['a > one', 'b > two', 'a > three']).map((g) => g.suite)).toEqual([
      'a',
      'b',
      'a',
    ])
  })

  // Several titles in this repo describe a comparison, so `>` inside a title is
  // real. Splitting on the last delimiter, or on all of them, would truncate
  // them silently — the worst kind of display bug, because the row still looks
  // like a row.
  it('splits on the first delimiter, so a title may contain one', () => {
    expect(groupFailures(['cost > rejects n > 1e5'])).toEqual([
      { suite: 'cost', titles: ['rejects n > 1e5'] },
    ])
  })

  // Round-trips against the join rather than against a hand-written string, so
  // changing the delimiter cannot pass this test while breaking the screen.
  it('inverts failedTestName', () => {
    const name = failedTestName({ suite: 'sums — cost', title: 'stays under budget' })
    expect(groupFailures([name])).toEqual([
      { suite: 'sums — cost', titles: ['stays under budget'] },
    ])
  })

  it('does not invent a suite for a name it did not build', () => {
    expect(groupFailures(['bare name'])).toEqual([{ suite: '', titles: ['bare name'] }])
  })
})
