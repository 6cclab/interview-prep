import { describe, expect, it } from 'vitest'
import { initOrder } from './solution'

/**
 * Checks an ordering rather than comparing against one fixed answer.
 *
 * Most inputs here admit many valid orders, and asserting equality against one
 * of them would fail a correct solution for choosing a different traversal.
 * That is the single most common way a topological-order test is wrong, so the
 * whole suite goes through this.
 */
function isValidOrder(
  order: string[] | null,
  libraries: string[],
  dependencies: Array<[string, string]>,
): true | string {
  if (order === null) return 'expected an ordering, got null'

  if (order.length !== libraries.length) {
    return `expected ${libraries.length} entries, got ${order.length}`
  }
  const seen = new Set(order)
  if (seen.size !== order.length) return 'an entry appears more than once'
  for (const lib of libraries) {
    if (!seen.has(lib)) return `missing ${lib}`
  }

  const position = new Map(order.map((name, i) => [name, i]))
  for (const [dependent, dependency] of dependencies) {
    const a = position.get(dependent)!
    const b = position.get(dependency)!
    if (b > a) return `${dependency} must come before ${dependent}`
  }
  return true
}

describe('initOrder — correctness', () => {
  it('puts a dependency before the library that needs it', () => {
    expect(initOrder(['a', 'b'], [['a', 'b']])).toEqual(['b', 'a'])
  })

  it('resolves a chain with exactly one valid order', () => {
    const libs = ['app', 'http', 'log']
    const deps: Array<[string, string]> = [
      ['app', 'http'],
      ['app', 'log'],
      ['http', 'log'],
    ]
    // Fully constrained, so equality is safe here and pins the direction of
    // the relation: a wrong reading of [x, y] reverses this exactly.
    expect(initOrder(libs, deps)).toEqual(['log', 'http', 'app'])
  })

  it('accepts any valid order when several exist', () => {
    const libs = ['a', 'b', 'c', 'd']
    const deps: Array<[string, string]> = [
      ['b', 'a'],
      ['d', 'c'],
    ]
    expect(isValidOrder(initOrder(libs, deps), libs, deps)).toBe(true)
  })

  it('handles a disconnected graph, including libraries with no dependencies', () => {
    // Two unrelated clusters plus two isolated libraries. Everything in the
    // input must still appear exactly once.
    const libs = ['a', 'b', 'c', 'd', 'lonely', 'alsolonely']
    const deps: Array<[string, string]> = [
      ['b', 'a'],
      ['d', 'c'],
    ]
    expect(isValidOrder(initOrder(libs, deps), libs, deps)).toBe(true)
  })

  it('treats a duplicate dependency as redundant, not as an error', () => {
    const order = initOrder(['a', 'b'], [['a', 'b'], ['a', 'b']])
    expect(order).toEqual(['b', 'a'])
  })

  it('does not double-count a library whose dependency is listed twice', () => {
    // A pending-count that is incremented per pair without dedup leaves 'a'
    // waiting on a decrement that never comes, and the output silently drops
    // it. That shows up as a short array rather than a wrong order.
    const libs = ['a', 'b', 'c']
    const deps: Array<[string, string]> = [
      ['a', 'b'],
      ['a', 'b'],
      ['a', 'c'],
    ]
    expect(isValidOrder(initOrder(libs, deps), libs, deps)).toBe(true)
  })

  it('returns null on a two-library cycle', () => {
    expect(initOrder(['a', 'b'], [['a', 'b'], ['b', 'a']])).toBeNull()
  })

  it('returns null on a longer cycle', () => {
    expect(
      initOrder(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']]),
    ).toBeNull()
  })

  it('returns null on a self-dependency', () => {
    // A library that depends on itself can never be initialized. Easy to miss
    // when the cycle check only looks for paths of length two or more.
    expect(initOrder(['a'], [['a', 'a']])).toBeNull()
  })

  it('returns null when a cycle sits beside a resolvable cluster', () => {
    // The healthy half must not rescue the input. A solution that returns
    // whatever it managed to order reports ['x', 'y'] here instead of null.
    const libs = ['a', 'b', 'x', 'y']
    const deps: Array<[string, string]> = [
      ['a', 'b'],
      ['b', 'a'],
      ['y', 'x'],
    ]
    expect(initOrder(libs, deps)).toBeNull()
  })

  it('returns null when a dependency names an unknown library', () => {
    expect(initOrder(['a'], [['a', 'ghost']])).toBeNull()
  })

  it('returns null when the dependent side is unknown', () => {
    // The unknown name can appear on either side of the pair.
    expect(initOrder(['a'], [['ghost', 'a']])).toBeNull()
  })

  it('handles an empty library list', () => {
    expect(initOrder([], [])).toEqual([])
  })

  it('handles libraries with no dependencies at all', () => {
    const libs = ['a', 'b', 'c']
    const order = initOrder(libs, [])
    expect(isValidOrder(order, libs, [])).toBe(true)
  })

  it('handles a single library', () => {
    expect(initOrder(['only'], [])).toEqual(['only'])
  })
})

describe('initOrder — scale', () => {
  /**
   * The correct-but-quadratic solution is the target here: repeatedly scan the
   * remaining libraries for one whose dependencies are all satisfied, take it,
   * and scan again. That produces a valid order and costs O(V^2). A solution
   * that tracks pending counts touches each library and each edge once.
   *
   * A single long chain is the adversarial shape, because each pass frees
   * exactly one library — but only if the scan cannot find that library
   * immediately. **The chain is therefore listed newest-first**, so the only
   * ready library sits at the far end of every scan. Listed oldest-first, the
   * same brute force finds its pick on the first or second look: measured
   * 330ms, against 24s for the identical input listed newest-first. The
   * ordering is the test, not an incidental detail.
   *
   * Measured at these sizes: pending-count solution 21ms, rescanning solution
   * 24s. 30,000 isolated libraries are mixed in so the scan cannot get cheap as
   * the chain drains, and so the disconnected case is exercised at size rather
   * than only in the small fixtures above.
   *
   * The expectation is checked structurally rather than against a fixed array:
   * the chain has exactly one valid relative order, but the isolated libraries
   * may be placed anywhere, so equality would be wrong.
   */
  it('finishes well within budget on a long chain plus many isolated libraries', () => {
    const CHAIN = 40_000
    const ISOLATED = 30_000

    const libraries: string[] = []
    const dependencies: Array<[string, string]> = []
    for (let i = 0; i < ISOLATED; i++) libraries.push(`free-${i}`)
    for (let i = CHAIN - 1; i >= 0; i--) libraries.push(`chain-${i}`)
    // chain-i depends on chain-(i-1), so chain-0 must come first.
    for (let i = 1; i < CHAIN; i++) dependencies.push([`chain-${i}`, `chain-${i - 1}`])

    const t0 = performance.now()
    const order = initOrder(libraries, dependencies)
    const elapsed = performance.now() - t0

    expect(order).not.toBeNull()
    expect(order!.length).toBe(CHAIN + ISOLATED)

    // The chain's members must appear in strictly increasing order relative to
    // each other. Checking positions is O(V); re-running isValidOrder here
    // would be O(E) too, but this states the intent more directly.
    const position = new Map(order!.map((name, i) => [name, i]))
    for (let i = 1; i < CHAIN; i++) {
      expect(position.get(`chain-${i}`)!).toBeGreaterThan(position.get(`chain-${i - 1}`)!)
    }

    // Vitest's testTimeout does not reliably preempt a synchronous, CPU-bound
    // loop, so elapsed time is measured explicitly rather than relied on.
    expect(elapsed).toBeLessThan(5000)
  })
})
