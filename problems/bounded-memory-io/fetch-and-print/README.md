# Fetch a URL and Print It

Fetch the contents of a URL and write it out, without ever holding the whole
response in memory.

The response may be far larger than you want resident — think a multi-gigabyte
log export. `await response.text()` and then writing it is the answer this
exercise exists to reject.

```ts
await fetchAndPrint('https://example.test/logs', { open, write })
```

## What you are given

Both the input and the output are handed to you, so nothing here touches the
real network or the real console:

```ts
interface Deps {
  /** Opens the URL and yields the body in chunks, in order. */
  open(url: string): AsyncIterable<Uint8Array>
  /** Writes one chunk out. Call it as many times as you like. */
  write(chunk: Uint8Array): void
}
```

Consume `open(url)` and pass the bytes to `write`, keeping only a bounded
amount in memory at a time. **The suite measures how many chunks you are
holding**, so accumulating and flushing at the end fails even though the bytes
written come out identical.

## Details that are easy to get wrong

- **Chunk boundaries are arbitrary.** They do not align to lines, characters,
  or anything else. Do not assume a chunk is a whole anything.
- **The body may be empty** — zero chunks. That is a success, not an error.
- **A zero-length chunk may appear** in the middle of a stream. It is not the
  end of the body.
- **`open` may throw**, and it may throw *partway through* iteration rather
  than at the start. Let the error propagate; do not swallow it and do not
  return normally as though the whole body arrived.
- Order matters. Bytes must be written in the order they arrived.

## Constraints

- Chunk count may be in the millions; total size may exceed available memory
- You may call `write` once per chunk, or fewer times if you buffer a bounded
  amount — but the bound must be a constant, not "the whole response"
- `write` is synchronous; `open` is async

## Signature

```ts
export async function fetchAndPrint(url: string, deps: Deps): Promise<void>
```

## Assumptions added to make this testable — read this

**This exercise is a reconstruction.** The reported prompt was, in full,
"efficiently fetch and print a URL". Everything below was added here so the
thing can be graded, and none of it is known to have been in the original:

- **The network is injected as `open`, not called directly.** A test suite that
  makes real HTTP requests is not a drill; it is a flaky integration test.
- **Output is injected as `write` rather than `console.log`**, so what was
  produced can be asserted.
- **The body arrives as an `AsyncIterable<Uint8Array>`**, which is what a real
  streaming body looks like in Node and in the Fetch API. The original may have
  meant a callback API, a Node `Readable`, or something else entirely.
- **"Efficiently" is defined as bounded memory**, since that is the only
  reading of the word that is measurable. It might have meant connection reuse,
  compression, or concurrency.

Treat the shape as one plausible interpretation, not as the question.

## Run it

```bash
pnpm test fetch-and-print     # attempt
pnpm reset fetch-and-print    # start over from a clean stub
```
