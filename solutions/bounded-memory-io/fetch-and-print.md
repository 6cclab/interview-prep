# Fetch a URL and Print It — worked solution

**Spoilers.** Don't open this until you've either solved
`problems/bounded-memory-io/fetch-and-print/` or given up on it for the session.

**This is a reconstruction.** The reported prompt was, in full, "efficiently
fetch and print a URL." The injected dependencies, the `AsyncIterable` body, and
the reading of "efficiently" as bounded memory were all added here to make it
gradable. See the Assumptions section on the problem's README.

## The answer

```ts
export async function fetchAndPrint(url: string, deps: Deps): Promise<void> {
  for await (const chunk of deps.open(url)) {
    deps.write(chunk)
  }
}
```

Three lines. Everything interesting about this exercise is in why the obvious
alternative is wrong and how you would know.

## The observation

The trap is that **the wrong answer produces byte-identical output.**

```ts
// WRONG — same bytes, same order, unbounded memory
const all = []
for await (const chunk of deps.open(url)) all.push(chunk)
for (const chunk of all) deps.write(chunk)
```

Diff the output of those two and you find nothing. They differ only in *when*
the writes happen relative to the reads, and that is not visible in the result —
which is precisely why this class of bug reaches production. Someone writes
`const body = await res.text()`, it works on every URL they test, and it falls
over the first time a customer points it at a 4GB log export.

So the property has to be measured, not inspected. The suite tracks the
high-water mark of chunks that have been yielded but not yet written, and
requires it to stay at a small constant no matter how long the body is. The
streaming version's peak is 1. The buffering version's peak is the length of the
response — 200,000 in the scale test.

The reframing worth carrying out of this drill: **the question is not "how much
data is there," it is "what is the largest thing your program holds at once, and
does that number depend on the input size?"** For a streaming loop the answer is
one chunk, which is a constant. That is the whole difference between O(n) space
and O(1) space, and it is what "efficiently" has to mean here — a buffering
solution is not slower, it is fine on time and fatal on space.

## Why `for await` is enough

`for await...of` does all of it. Each iteration suspends until the next chunk is
available, so there is exactly one chunk resident at a time and no explicit
buffer anywhere. The loop is also the backpressure: you do not ask for the next
chunk until you have written the current one.

That last property is what people reach for a manual `reader.read()` loop to get,
and it is already there. If `write` were asynchronous the same shape still works
— `await deps.write(chunk)` inside the loop — and the source is not pulled while
the write is pending. Being able to say that is the difference between having
memorized the syntax and understanding it.

## Errors are the second half of the problem

`open` may throw partway through iteration — a connection reset after a
gigabyte has already arrived. The correct behavior is to let it propagate.

The tempting defensive shape is exactly wrong:

```ts
try {
  for await (const chunk of deps.open(url)) deps.write(chunk)
} catch {
  // swallowed
}
```

Now the function resolves normally. The caller has no way to distinguish "the
whole body was written" from "half the body was written and the connection
died," and will treat a truncated response as complete. Silent truncation is a
worse outcome than a crash, because the crash is at least reported.

The three-line version handles this with no code at all: an exception from the
iterator propagates out of the `for await` and rejects the returned promise.
Bytes already written stay written, which is correct — they did arrive.

If you *do* need a `try`, it is for cleanup, and it needs a `finally` that
releases the resource plus a rethrow. Say that out loud rather than reaching for
a bare `catch`.

## Edge cases and where they bite

- **An empty body** — zero chunks. The loop body never runs, the promise
  resolves, nothing is written. Success, not an error.
- **A zero-length chunk in the middle of the stream.** This is the fixture that
  catches C-style habits: `while ((n = read()) > 0)` treats a zero-length read as
  end-of-stream and silently truncates everything after it. In an iterator
  protocol the terminator is `done`, not an empty value.
- **Arbitrary chunk boundaries.** Chunks do not align to lines, characters, or
  records. Anything that decodes a chunk in isolation splits multi-byte
  characters at the boundary. Not tested here — the exercise deliberately keeps
  bytes as bytes — but it is the first follow-up an interviewer asks, and the
  answer is a streaming decoder that carries the partial tail across chunks
  (`TextDecoder` with `{stream: true}`).

## What an interviewer is listening for

- Asking how large the response can be, before writing anything. That single
  question is most of the signal — it is what separates someone who has operated
  a service from someone who has only called an API.
- Saying "bounded memory" when asked what "efficiently" means, and noticing that
  the word is ambiguous. It could equally have meant connection reuse or
  compression; picking a reading and naming it is better than assuming.
- Not swallowing errors, and being able to explain that a truncated success is
  worse than a failure.
- The natural follow-ups, which are where a Medium becomes a Senior: what if you
  need to decode text? What if you need to write to something slower than the
  source? What if the connection drops at 90% — can you resume with a `Range`
  header? Each one is answerable from the same loop.

## Complexity

- **Time** — O(n) in the number of bytes. Each byte is read once and written
  once; there is no lower bound to beat.
- **Space** — O(1). Bounded by the largest single chunk, which is a property of
  the transport, not of the response size. This is the number the drill is about.
