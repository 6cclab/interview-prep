/**
 * Tracks the k-th largest value across a growing stream of numbers.
 *
 * `nums` is the initial set of values already seen. After construction,
 * `add` is called repeatedly, each time contributing one more value to the
 * set that has ever been seen (values are never removed, and duplicates are
 * kept — they are not deduplicated).
 */
export class KthLargest {
  /**
   * @param k the rank to track (1 = largest value seen so far).
   * @param nums the values already seen before any `add` call.
   */
  constructor(k: number, nums: number[]) {
    throw new Error('not implemented')
  }

  /**
   * Records one more value as seen, then returns the k-th largest value
   * seen so far (counting duplicates, largest first). If fewer than k
   * values have been seen in total (initial values plus adds so far),
   * returns the smallest value seen so far instead.
   *
   * @param val the newly observed value.
   * @returns the k-th largest value seen so far.
   */
  add(val: number): number {
    throw new Error('not implemented')
  }
}
