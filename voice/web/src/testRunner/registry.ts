import type { RegisteredTest, RunLog, SuiteResult, TestOutcome } from './types'

/**
 * `describe`/`it` collection and execution.
 *
 * vitest collects a file in two phases: importing the module runs every
 * `describe` callback synchronously (registering its `it`s against the
 * `describe` names in scope), then a separate pass actually runs each `it`.
 * This mirrors that split — `describe`/`it` only ever populate `tests` here;
 * `runSuite` is the second pass. None of the 42 suites this shim targets
 * nests a `describe` inside a `describe` (verified: no suite has a `describe(`
 * line indented under another), but the stack below costs nothing and means a
 * suite that starts nesting doesn't silently mis-attribute its `ancestorTitles`.
 */

let stack: string[] = []
let tests: RegisteredTest[] = []

export function describe(name: string, fn: () => void): void {
  stack.push(name)
  try {
    fn()
  } finally {
    stack.pop()
  }
}

export function it(name: string, fn: () => unknown | Promise<unknown>): void {
  tests.push({ ancestorTitles: [...stack], title: name, fn })
}

/** Drops every registered test — called between suites so one worker can run more than one file. */
export function resetRegistry(): void {
  stack = []
  tests = []
}

/**
 * Runs every registered test in registration order and clears the registry.
 *
 * Sync and async `it` bodies are both `await`ed: awaiting a non-promise
 * return value is a no-op, so one code path covers both without inspecting
 * the function first.
 */
/**
 * Caps on captured output.
 *
 * A `console.log` inside the loop a scale test is hammering produces output at
 * the rate of the loop — hundreds of thousands of lines, every one of which
 * would be structured-cloned out of the Worker and then rendered. The cap is
 * not tidiness; without it the debugging aid is a way to lock up the tab.
 *
 * Lines are kept from the *start* rather than the end: the first few prints of
 * a loop are what tell you what it is doing, and the hundred-thousandth is the
 * same line again.
 */
const MAX_LOG_LINES = 200
const MAX_LINE_CHARS = 2_000

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const

/** `console.log(a, b)` the way a console shows it, without pulling in a formatter. */
function render(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg
      try {
        return JSON.stringify(arg) ?? String(arg)
      } catch {
        // Circular, or something with a throwing getter. Their object, their
        // problem — but it must not take the run down with it.
        return String(arg)
      }
    })
    .join(' ')
}

export async function runSuite(): Promise<SuiteResult> {
  const outcomes: TestOutcome[] = []
  const logs: RunLog[] = []
  let truncated = false

  const console_ = globalThis.console
  const original = LEVELS.map((level) => [level, console_[level]] as const)

  for (const test of tests) {
    const name = [...test.ancestorTitles, test.title].join(' > ')
    for (const level of LEVELS) {
      console_[level] = (...args: unknown[]): void => {
        if (logs.length >= MAX_LOG_LINES) {
          truncated = true
          return
        }
        logs.push({ test: name, level, text: render(args).slice(0, MAX_LINE_CHARS) })
      }
    }
    try {
      await test.fn()
      outcomes.push({ ancestorTitles: test.ancestorTitles, title: test.title, status: 'passed' })
    } catch (error) {
      outcomes.push({
        ancestorTitles: test.ancestorTitles,
        title: test.title,
        status: 'failed',
        debugMessage: error instanceof Error ? error.message : String(error),
      })
    } finally {
      // Restored inside the loop, not after it: a test that throws must not
      // leave the next one's output going into a stale capture, and a suite
      // that throws during registration must not leave the Worker's console
      // permanently replaced.
      for (const [level, fn] of original) console_[level] = fn
    }
  }

  if (truncated) {
    logs.push({
      test: '',
      level: 'warn',
      text: `… output stopped after ${MAX_LOG_LINES} lines.`,
    })
  }

  resetRegistry()
  return { outcomes, logs }
}
