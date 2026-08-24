/**
 * `expect()`, scoped to exactly the matchers the 42 `problems/**` suites use.
 *
 * The inventory (re-verified against the suites on 2026-08-13, since the
 * repo has grown since the count this was commissioned against): `toBe` 347,
 * `toEqual` 111, `toBeLessThan` 34, `toBeNull` 28, `toHaveLength` 3,
 * `toBeGreaterThanOrEqual` 3, `toBeGreaterThan` 3, `toBeUndefined` 2,
 * `toBeLessThanOrEqual` 2, plus `.not.toBe` / `.not.toBeNull` and
 * `.rejects.toThrow(message)`. Nothing else appears — no `toContain`, no
 * `toMatchObject`, no `toBeCloseTo`, no `vi.*` mocking. Adding a matcher this
 * repo never calls would be dead code with no suite to catch it going stale;
 * a suite that starts using a new one fails loudly here (`expect(...).foo is
 * not a function`) rather than silently, which is the point of building this
 * against the verified surface instead of vitest's full one.
 */

class MatcherFailure extends Error {}

function fail(message: string): never {
  throw new MatcherFailure(message)
}

/** Structural equality over plain data — arrays, objects, primitives, `Date`. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const aKeys = Object.keys(ao)
    const bKeys = Object.keys(bo)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) => Object.prototype.hasOwnProperty.call(bo, key) && deepEqual(ao[key], bo[key]))
  }
  return false
}

function describeValue(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

interface Matchers {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toBeNull(): void
  toBeUndefined(): void
  toHaveLength(length: number): void
  toBeGreaterThan(expected: number): void
  toBeGreaterThanOrEqual(expected: number): void
  toBeLessThan(expected: number): void
  toBeLessThanOrEqual(expected: number): void
}

/** Builds the matcher object for one `actual`, `negated` tracking `.not`. */
function buildMatchers(actual: unknown, negated: boolean): Matchers {
  // A matcher's own pass/fail is computed once and flipped by `negated` at the
  // single call to `assert` below, so `.not` never needs a second copy of each
  // matcher's logic — the risk that copy would drift from the original.
  const assert = (condition: boolean, verb: string): void => {
    if (condition === negated) {
      const not = negated ? 'not ' : ''
      fail(`expected ${describeValue(actual)} ${not}${verb}`)
    }
  }

  return {
    toBe(expected) {
      assert(Object.is(actual, expected), `to be ${describeValue(expected)}`)
    },
    toEqual(expected) {
      assert(deepEqual(actual, expected), `to equal ${describeValue(expected)}`)
    },
    toBeNull() {
      assert(actual === null, 'to be null')
    },
    toBeUndefined() {
      assert(actual === undefined, 'to be undefined')
    },
    toHaveLength(length) {
      const actualLength = (actual as { length?: unknown })?.length
      assert(actualLength === length, `to have length ${length}`)
    },
    toBeGreaterThan(expected) {
      assert(typeof actual === 'number' && actual > expected, `to be greater than ${expected}`)
    },
    toBeGreaterThanOrEqual(expected) {
      assert(typeof actual === 'number' && actual >= expected, `to be greater than or equal to ${expected}`)
    },
    toBeLessThan(expected) {
      assert(typeof actual === 'number' && actual < expected, `to be less than ${expected}`)
    },
    toBeLessThanOrEqual(expected) {
      assert(typeof actual === 'number' && actual <= expected, `to be less than or equal to ${expected}`)
    },
  }
}

/**
 * Checks that a promise rejects, and — when a message is given — that the
 * rejection's message contains it. Mirrors vitest's `toThrow(string)`
 * (substring, not equality), the only form `.rejects.toThrow` is called with
 * in these suites.
 */
async function rejectsToThrow(promise: Promise<unknown>, expected?: string): Promise<void> {
  let threw = false
  let message = ''
  try {
    await promise
  } catch (error) {
    threw = true
    message = error instanceof Error ? error.message : String(error)
  }
  if (!threw) fail('expected promise to reject, but it resolved')
  if (expected !== undefined && !message.includes(expected)) {
    fail(`expected rejection message to include ${describeValue(expected)}, got ${describeValue(message)}`)
  }
}

export interface Expectation extends Matchers {
  readonly not: Matchers
  readonly rejects: {
    toThrow(expected?: string): Promise<void>
  }
}

export function expect(actual: unknown): Expectation {
  // `not` and `rejects` are getters, not eagerly-computed properties: an
  // object built with `{ ...buildMatchers(...) }` would evaluate every getter
  // at spread time (JS reads enumerable own properties, including
  // accessors, to copy them), building a throwaway negated-matchers object on
  // every `expect()` call whether `.not` is ever read or not. Getters here
  // stay lazy — each is built only if the suite actually reads it.
  return {
    ...buildMatchers(actual, false),
    get not() {
      return buildMatchers(actual, true)
    },
    get rejects() {
      return {
        toThrow: (expected?: string) => rejectsToThrow(actual as Promise<unknown>, expected),
      }
    },
  }
}
