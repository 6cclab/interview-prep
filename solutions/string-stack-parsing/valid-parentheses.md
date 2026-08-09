# Valid Parentheses — worked solution

> **Spoilers.** Do not read this during an attempt.

## The observation

Nesting is last-in-first-out by definition. When a closing bracket arrives, the
only bracket it is allowed to close is the *most recently opened* one still
open — so the only state you need is the sequence of currently-open brackets in
the order they were opened, and you only ever touch its end. That is a stack.

Push every opener. On a closer, pop and check the kinds match. Balanced means you
never mismatched and the stack is empty at the end. Both halves of that sentence
are load-bearing: an empty stack when a closer arrives is a failure, and a
non-empty stack at the end is a failure.

## Reference solution

```ts
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

export function isBalanced(text: string): boolean {
  const open: string[] = []
  for (const ch of text) {
    const expected = CLOSERS[ch]
    if (expected === undefined) {
      open.push(ch)
      continue
    }
    if (open.pop() !== expected) return false
  }
  return open.length === 0
}
```

`open.pop()` on an empty array is `undefined`, which can never equal a bracket
character — so the "closer with nothing open" case falls out of the same
comparison rather than needing its own branch.

## Cost

Time O(n), space O(n) in the worst case — a fully nested string keeps every
opener on the stack at once. The removal-based brute force is O(n²) time.

## What the suite was testing

A scale test, and the fixture choice is the interesting part. The natural brute
force is to keep sweeping the string deleting adjacent matched pairs until
nothing changes. On a *random* mix that collapses most of the string in the first
few sweeps and would slip under any reasonable budget. On a fully nested string
it exposes exactly one pair per sweep, so it needs n/2 sweeps of O(n) work —
measured at 33 seconds at 100,000 levels of nesting.

The correctness half turns on `([)]`: every bracket kind balances by count, and
the nesting is still wrong. That single case is what separates a stack from three
counters, and a counting solution passes everything else in the suite.

## The tell

**Matching, nesting, or "most recent" anything.** Brackets, tags, undo, function
scopes, "collapse the innermost group first." If the correctness of processing
element *i* depends on the nearest unresolved element to its left, that is a
stack — and if it depends on the nearest *smaller or larger* element to its
left, it is the monotonic variant.
