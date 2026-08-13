import type { RegisteredTest, SuiteResult, TestOutcome } from './types'

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
export async function runSuite(): Promise<SuiteResult> {
  const outcomes: TestOutcome[] = []
  for (const test of tests) {
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
    }
  }
  resetRegistry()
  return { outcomes }
}
