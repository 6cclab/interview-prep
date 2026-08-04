/**
 * Test-harness utilities for drills whose difficulty is an operation budget
 * rather than an output value.
 *
 * A drill is only worth doing if a correct-but-brute-force answer fails it.
 * Where the problem hands the solver an expensive oracle, wrap it with
 * `countCalls` and assert a budget with `assertWithinBudget`.
 */

export interface CountingOracle<T> {
  /** Drop-in replacement for the wrapped function. */
  readonly fn: T
  /** How many times `fn` has been invoked. */
  readonly calls: number
}

export function countCalls<T extends (...args: never[]) => unknown>(
  fn: T,
): CountingOracle<T> {
  let calls = 0
  const wrapped = ((...args: Parameters<T>) => {
    calls += 1
    return fn(...(args as never[]))
  }) as T

  return {
    fn: wrapped,
    get calls() {
      return calls
    },
  }
}

export function assertWithinBudget(
  calls: number,
  budget: number,
  label: string,
): void {
  if (calls > budget) {
    throw new Error(
      `${label}: used ${calls} calls, budget is ${budget}. ` +
        `A correct answer is not enough here — brute force blows the budget. ` +
        `Find the observation that lets you discard work permanently.`,
    )
  }
}
