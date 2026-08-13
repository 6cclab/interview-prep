export interface Deps {
  /** Opens the URL and yields the body in chunks, in order. May throw, including partway through. */
  open(url: string): AsyncIterable<Uint8Array>
  /** Writes one chunk out. Synchronous. */
  write(chunk: Uint8Array): void
}

/**
 * Fetches a URL and writes its body out, holding only a bounded amount of it
 * in memory at any moment — the response may be larger than memory.
 *
 * @param url the URL to pass to `deps.open`.
 * @param deps injected I/O; see the README for why it is injected.
 * @returns a promise resolving once the whole body has been written. If
 *   `open` throws, at any point, the error propagates rather than resolving.
 */
export async function fetchAndPrint(url: string, deps: Deps): Promise<void> {
  throw new Error('not implemented')
}
