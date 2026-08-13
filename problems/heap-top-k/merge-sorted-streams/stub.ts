/**
 * Merges several individually-sorted sources into one ascending stream.
 *
 * Must be lazy: taking n values from the result reads about n values from the
 * sources in total, not all of them. A source may be infinite. Each source may
 * be iterated once.
 *
 * @param sources iterables of numbers, each already ascending within itself.
 * @returns an iterable yielding every value from every source, ascending.
 */
export function mergeSorted(sources: Array<Iterable<number>>): Iterable<number> {
  throw new Error('not implemented')
}
