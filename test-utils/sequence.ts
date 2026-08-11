/**
 * Comparing long sequences without printing them.
 *
 * `expect(big).toEqual(alsoBig)` is unusable at scale, and the failure mode is
 * not just ugly — it is *blinding*. A 100,000-element mismatch fills the terminal
 * with a diff nobody can read and pushes every other failure in the suite off
 * screen, so the one signal a drill exists to give (which cases fail) is lost to
 * the one case that fails loudest. A 100k-element `toEqual` also took vitest about
 * a minute to render.
 *
 * So the scale cases compare through `firstDifference` instead: on a mismatch it
 * returns one short line naming the first index that differs and a small window
 * either side, which is both compact *and* more useful than a full diff — the
 * index tells you where the logic broke, which a wall of characters does not.
 */

/** How many neighbours either side of the mismatch to show. */
const WINDOW = 6

function show<T>(values: readonly T[], from: number, to: number): string {
  const slice = values.slice(Math.max(0, from), to).map((v) => JSON.stringify(v))
  return `[${from > 0 ? '…, ' : ''}${slice.join(', ')}${to < values.length ? ', …' : ''}]`
}

/**
 * @returns null when the sequences match, or a single-line description of the
 *   first place they diverge. Never includes the whole sequence.
 */
export function firstDifference<T>(actual: readonly T[], expected: readonly T[]): string | null {
  if (actual.length !== expected.length) {
    return `length ${actual.length}, expected ${expected.length}`
  }
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] === expected[i]) continue
    const from = i - WINDOW
    const to = i + WINDOW + 1
    return (
      `first difference at index ${i}: got ${JSON.stringify(actual[i])}, ` +
      `expected ${JSON.stringify(expected[i])}\n` +
      `  got      ${show(actual, from, to)}\n` +
      `  expected ${show(expected, from, to)}`
    )
  }
  return null
}

/** `firstDifference` over the characters of two strings. */
export function firstCharDifference(actual: string, expected: string): string | null {
  return firstDifference([...actual], [...expected])
}
