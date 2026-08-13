import { describe, expect, it } from 'vitest'
import {
  describe as d,
  expect as e,
  it as t,
  resetRegistry,
  runSuite,
  toFailedTests,
} from './shim'
import { classifyFailures } from '../../../drill-verdict'

// Every test here registers against the shim's own module-level registry, so
// each one resets it first — otherwise a suite registered by an earlier test
// in this file would still be sitting there and get run twice.
function freshSuite(build: () => void): ReturnType<typeof runSuite> {
  resetRegistry()
  build()
  return runSuite()
}

describe('a passing suite', () => {
  it('reports no failures', async () => {
    const result = await freshSuite(() => {
      d('addition', () => {
        t('adds two numbers', () => {
          e(1 + 1).toBe(2)
        })
      })
    })
    expect(toFailedTests(result)).toEqual([])
  })
})

describe('a failing assertion', () => {
  it('names the failing test and nothing else', async () => {
    const result = await freshSuite(() => {
      d('addition', () => {
        t('adds two numbers', () => {
          e(1 + 1).toBe(3)
        })
        t('adds zero', () => {
          e(1 + 0).toBe(1)
        })
      })
    })
    expect(toFailedTests(result)).toEqual([{ suite: 'addition', title: 'adds two numbers' }])
  })
})

describe('an async test', () => {
  it('is awaited, so an async failure is not missed', async () => {
    const result = await freshSuite(() => {
      d('fetching', () => {
        t('resolves to the right value', async () => {
          const value = await Promise.resolve(42)
          e(value).toBe(41)
        })
      })
    })
    expect(toFailedTests(result)).toEqual([{ suite: 'fetching', title: 'resolves to the right value' }])
  })
})

describe('.rejects.toThrow', () => {
  it('passes when the promise rejects with a matching message', async () => {
    const result = await freshSuite(() => {
      d('a flaky fetch', () => {
        t('propagates the underlying error', async () => {
          const failing = Promise.reject(new Error('connection reset'))
          await e(failing).rejects.toThrow('connection reset')
        })
      })
    })
    expect(toFailedTests(result)).toEqual([])
  })

  it('fails when the promise resolves instead of rejecting', async () => {
    const result = await freshSuite(() => {
      d('a flaky fetch', () => {
        t('should have rejected but did not', async () => {
          await e(Promise.resolve('fine')).rejects.toThrow('connection reset')
        })
      })
    })
    expect(toFailedTests(result)).toEqual([{ suite: 'a flaky fetch', title: 'should have rejected but did not' }])
  })
})

describe('a thrown non-assertion error', () => {
  it('is caught and reported as a failure like any other', async () => {
    const result = await freshSuite(() => {
      d('a bug', () => {
        t('throws before asserting anything', () => {
          throw new TypeError('cannot read property of undefined')
        })
      })
    })
    expect(toFailedTests(result)).toEqual([{ suite: 'a bug', title: 'throws before asserting anything' }])
  })
})

describe('.not', () => {
  it('passes when the negated condition holds', async () => {
    const result = await freshSuite(() => {
      d('cycle detection', () => {
        t('the meeting point is not the head', () => {
          e(3).not.toBe(1)
          e(null).not.toBeNull()
        })
      })
    })
    // Two assertions in one `it`: the first (`.not.toBe`) passes, the second
    // (`.not.toBeNull()` on `null`) does not — this pins that `.not` actually
    // flips the underlying matcher rather than always passing.
    expect(toFailedTests(result)).toEqual([{ suite: 'cycle detection', title: 'the meeting point is not the head' }])
  })

  it('a solely-passing .not case reports no failure', async () => {
    const result = await freshSuite(() => {
      d('cycle detection', () => {
        t('the result is not the excluded node', () => {
          e('a').not.toBe('b')
        })
      })
    })
    expect(toFailedTests(result)).toEqual([])
  })
})

describe('nested describe > it produces vitest-shaped ancestorTitles', () => {
  // Mirrors the structure real suites use (e.g.
  // `problems/topological-sort/library-order/solution.test.ts`): a
  // `describe` for one behaviour, `it`s under it — the shape
  // `voice/drill-verdict.ts`'s `failedTestsFromJson` reads off a real vitest
  // JSON report as `ancestorTitles` + `title`, joined with ` > ` for `suite`.
  // This proves this shim's output feeds the same `classifyFailures` without
  // adapting it.
  it('classifies a correctness failure exactly as classifyFailures would from a real report', async () => {
    const result = await freshSuite(() => {
      d('initOrder — correctness', () => {
        t('puts a dependency before the library that needs it', () => {
          e(['a', 'b']).toEqual(['b', 'a'])
        })
      })
      d('initOrder — scale', () => {
        t('resolves a large graph within budget', () => {
          e(1).toBe(1)
        })
      })
    })
    const failed = toFailedTests(result)
    expect(failed).toEqual([
      { suite: 'initOrder — correctness', title: 'puts a dependency before the library that needs it' },
    ])
    expect(classifyFailures(failed)).toEqual({
      kind: 'correctness-red',
      failed: ['initOrder — correctness > puts a dependency before the library that needs it'],
    })
  })
})
