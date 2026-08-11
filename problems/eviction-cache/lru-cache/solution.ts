/**
 * A fixed-capacity key/value store that discards the entry which has gone
 * longest without being used, once a write would take it past capacity.
 *
 * Both `get` and `put` count as using a key.
 */
export class Cache {
  /**
   * @param capacity the maximum number of entries held at once; at least 1.
   */
  constructor(capacity: number) {
    throw new Error('not implemented')
  }

  /**
   * Reads a key, and counts as using it.
   *
   * @param key the key to read.
   * @returns the stored value, or -1 if the key is not currently held.
   */
  get(key: number): number {
    throw new Error('not implemented')
  }

  /**
   * Writes a key, and counts as using it. If the key is already held its
   * value is replaced and nothing is evicted. Otherwise the entry is added,
   * evicting the least recently used entry first if the store is full.
   *
   * @param key the key to write.
   * @param value the value to store against it.
   */
  put(key: number, value: number): void {
    throw new Error('not implemented')
  }
}
