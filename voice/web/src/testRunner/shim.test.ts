import { beforeEach, describe, expect, it } from 'vitest'
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

  it('says what it was, in the log, attributed to the test it happened in', async () => {
    // The regression this guards against has a real name. A buffer said
    // `this.map.keys()` where the field was `store`; every test called `put`,
    // `put` threw on its first line, and all ten went red with nothing on
    // screen to distinguish "you have a typo" from "your algorithm is wrong".
    // The message was being computed and then dropped.
    const result = await freshSuite(() => {
      d('a bug', () => {
        t('reads through an undefined field', () => {
          const self = {} as { map?: { keys(): unknown } }
          self.map!.keys()
        })
      })
    })
    expect(result.logs).toEqual([
      {
        test: 'a bug > reads through an undefined field',
        level: 'error',
        text: expect.stringContaining('TypeError'),
      },
    ])
  })

  it('still says nothing about a matcher failure', async () => {
    // The other direction, and the more important one: a matcher's message
    // quotes the fixture it compared against, and a fixture is part of the
    // answer. `drill-tests.ts` states the rule; this is the browser runner's
    // copy of it. If this test fails, the leak is the defect.
    const result = await freshSuite(() => {
      d('wrong', () => {
        t('returns the wrong number', () => {
          e(1).toBe(4181)
        })
      })
    })
    expect(result.logs).toEqual([])
    expect(JSON.stringify(result.logs)).not.toContain('4181')
  })

  it('keeps the error even when the same test filled the log', async () => {
    // The cap is there to survive a `console.log` inside a scale-test loop. It
    // must not be what decides whether the explanation for the failure is on
    // screen — a chatty test that then crashes is exactly when the crash
    // matters most.
    const result = await freshSuite(() => {
      d('noisy', () => {
        t('prints a lot and then throws', () => {
          for (let i = 0; i < 500; i++) console.log('line', i)
          throw new RangeError('too far')
        })
      })
    })
    // Present despite the cap having already stopped this test's own output —
    // and still sitting with that output rather than at the end of the run,
    // because `RunOutput` groups by test and a line that drifted out of its
    // group would be attributed to whatever ran next. (The truncation notice
    // is what is genuinely last; it belongs to the run, not to a test.)
    expect(result.logs).toContainEqual({
      test: 'noisy > prints a lot and then throws',
      level: 'error',
      text: 'RangeError: too far',
    })
    expect(result.logs.at(-1)?.text).toContain('output stopped after')
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

/**
 * Console capture.
 *
 * The point of the feature: a `console.log` in the candidate's code has to
 * reach the screen, attributed to the test that was running. The point of
 * these tests is the ways that can go wrong — capture outliving a run, output
 * from a throwing test being lost, and a log inside a hot loop filling the tab.
 */
describe('captured output', () => {
  beforeEach(() => resetRegistry())

  it('attributes a line to the test that printed it', async () => {
    d('adds — correctness', () => {
      t('handles zero', () => {
        console.log('seen', 1)
      })
    })
    const { logs } = await runSuite()
    expect(logs).toHaveLength(1)
    expect(logs[0]?.test).toBe('adds — correctness > handles zero')
    expect(logs[0]?.text).toBe('seen 1')
    expect(logs[0]?.level).toBe('log')
  })

  // A failing test is the one you most want the output of.
  it('keeps output from a test that then threw', async () => {
    t('throws after printing', () => {
      console.log('got here')
      throw new Error('boom')
    })
    const { logs, outcomes } = await runSuite()
    expect(outcomes[0]?.status).toBe('failed')
    expect(logs[0]?.text).toBe('got here')
  })

  /**
   * The console must be the real one again after a run.
   *
   * A capture left installed would swallow every later `console.log` in the
   * Worker — including, on a second run, the previous run's collector, which
   * holds a reference to an array nothing reads. Silent, and permanent for the
   * life of the Worker.
   */
  it('restores the console even when a test throws', async () => {
    const before = console.log
    t('throws', () => {
      throw new Error('boom')
    })
    await runSuite()
    expect(console.log).toBe(before)
  })

  it('records the level, so a warning is not shown as a log', async () => {
    t('warns', () => {
      console.warn('careful')
      console.error('bad')
    })
    const { logs } = await runSuite()
    expect(logs.map((l) => l.level)).toEqual(['warn', 'error'])
  })

  it('renders objects rather than printing [object Object]', async () => {
    t('logs an object', () => {
      console.log({ left: 0, right: 3 })
    })
    const { logs } = await runSuite()
    expect(logs[0]?.text).toBe('{"left":0,"right":3}')
  })

  // Their object, their problem — but it must not take the run down.
  it('survives a value that cannot be serialised', async () => {
    t('logs something circular', () => {
      const circular: Record<string, unknown> = {}
      circular.self = circular
      console.log(circular)
    })
    const { logs, outcomes } = await runSuite()
    expect(outcomes[0]?.status).toBe('passed')
    expect(logs).toHaveLength(1)
  })

  /**
   * A log inside the loop a scale test hammers prints at the rate of the loop.
   * Uncapped, the debugging aid becomes a way to lock up the tab: every line is
   * structured-cloned out of the Worker and then rendered.
   */
  it('caps runaway output and says that it did', async () => {
    t('prints far too much', () => {
      for (let i = 0; i < 5_000; i++) console.log('line', i)
    })
    const { logs } = await runSuite()
    expect(logs.length).toBeLessThan(5_000)
    expect(logs.at(-1)?.text).toMatch(/output stopped after/)
    // Kept from the start: the first prints say what the loop is doing; the
    // five-thousandth is the same line again.
    expect(logs[0]?.text).toBe('line 0')
  })
})
