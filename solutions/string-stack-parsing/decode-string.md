# Decode String — worked solution

> Spoiler. `.claude/rules/no-spoilers.md` forbids reading this into context
> unless Andre explicitly asks for it.

## The observation

Nesting is exactly what a stack models. Every time a `[` opens a new group,
you need to remember two things about the group you were building *before*
it: the repeat count that will apply once the group closes, and the text
you'd already accumulated outside it. Both of those are exactly what a `]`
needs to hand back, in last-opened-first-closed order — which is a stack.

So: walk `s` once, left to right, keeping a "current string" being built.

- On a digit, accumulate it into the current repeat count (see below —
  multi-digit `k` matters).
- On `[`, push the repeat count and the string built so far, then reset both
  — you're now building the *inside* of the new group from scratch.
- On `]`, pop the count and the string that was waiting, and splice: the
  popped string, followed by the just-finished inner string repeated that
  many times, becomes the new "current string".
- On a letter, append it to the current string.

At the end, "current string" is the answer. One left-to-right pass, no
rebuilding anything already built.

## Reference solution

```ts
export function decodeString(s: string): string {
  const counts: number[] = []
  const prevStrings: string[] = []
  let current = ''
  let num = 0

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch >= '0' && ch <= '9') {
      num = num * 10 + (ch.charCodeAt(0) - 48)
    } else if (ch === '[') {
      counts.push(num)
      prevStrings.push(current)
      num = 0
      current = ''
    } else if (ch === ']') {
      const k = counts.pop()!
      const prev = prevStrings.pop()!
      current = prev + current.repeat(k)
    } else {
      current += ch
    }
  }

  return current
}
```

## Complexity

- **Time:** O(n + output length). The scan of `s` is O(n). The `.repeat()` and
  string-concatenation calls collectively produce each character of the final
  output exactly once — no character is copied more times than the number of
  groups it sits inside, and each group contributes its content once per
  `]`, so the total work across all splices is bounded by the size of the
  final decoded string, not by the number of passes over the input.
- **Space:** O(n) for the two stacks in the worst case (a string that is
  nothing but nested `1[` opens), plus O(output length) for the result.

## The multi-digit accumulation detail

`k` isn't always one digit — `12[a]` means `a` repeated 12 times, not `1[a]`
followed by `2[a]`. That's why digits don't immediately become a number; they
accumulate into `num` via `num = num * 10 + digit` across every consecutive
digit character, and `num` is only pushed (and reset to `0`) when a `[` is
hit. Reading only a single digit per group is a natural, easy-to-miss bug —
it happens to give the right answer on every example that only uses
single-digit counts, which is exactly what makes it easy to ship unnoticed.

## Why "text before and after a nested group" breaks naive approaches

`2[a2[b]c]` is the case that catches a solution which conflates "current
string" with "string since the last group closed". Inside the outer group,
there's a letter (`a`) *before* the nested `2[b]`, and another letter (`c`)
*after* it, both belonging to the same outer group. If you don't have a
notion of "the string that was building before this bracket opened" pushed
onto a stack and correctly restored when it closes, it's easy to either lose
the `a` (by resetting `current` on `[` without saving what came before) or
lose the `c` (by treating `]` as "done with this group" without leaving
`current` in a state that can still accept more characters at the outer
level). The stack formulation handles both for free: `prevStrings.pop()` on
`]` always restores exactly the prefix that was pending, and control returns
to the outer loop iteration ready to keep appending — including the `c` that
comes right after.

## The recursive alternative

The same idea maps directly onto recursion, with the call stack standing in
for the explicit stack:

```ts
export function decodeString(s: string): string {
  let i = 0

  function decode(): string {
    let current = ''
    let num = 0
    while (i < s.length && s[i] !== ']') {
      const ch = s[i]!
      if (ch >= '0' && ch <= '9') {
        num = num * 10 + (ch.charCodeAt(0) - 48)
      } else if (ch === '[') {
        i++ // consume '['
        const inner = decode()
        i++ // consume ']'
        current += inner.repeat(num)
        num = 0
      } else {
        current += ch
        i++
      }
    }
    return current
  }

  return decode()
}
```

Each recursive call to `decode()` handles exactly one nesting level, reading
until it either exhausts `s` or hits the `]` that closes it, then returns its
built string to the caller — which is precisely "pop and splice" without an
explicit stack array. The two approaches do the same work in the same order;
pick whichever you're faster to write correctly under pressure. (The explicit
stack avoids the recursion depth limit on pathologically deep nesting, which
is one reason to prefer it if that ever comes up.)

## Sibling problems (same pattern)

- **Basic Calculator (I/II)**: same idea, but the stack holds pending signs
  and partial sums/products across parenthesized sub-expressions instead of
  repeat counts and partial strings.
- **Flatten Nested List Iterator**: nesting is explicit (a list can contain
  lists), and a stack of "where am I in this level" iterators handles it the
  same way.
- **Validate/Simplify Path**: not encoded nesting, but the same "push on the
  way in, pop and resolve on the way out" discipline applied to directory
  components.
- **Remove Adjacent Duplicates / Valid Parentheses**: simpler cousins — a
  stack that just needs to hold "what's still open," no accompanying payload.

## The tell

Look for: nesting, or any pair of delimiters that has to balance (brackets,
parens, tags), where resolving the inner thing is a prerequisite for
resolving the outer thing, and what to do with the outer thing depends on
state that was captured *before* you went inside. Whenever "finishing this
inner piece hands something back to whatever was in progress outside it,"
that's a stack — push the in-progress state before you descend, pop and
combine it when you come back up.

## Interview notes

- Say the multi-digit accumulation rule out loud before coding — it's the
  single most common thing skipped, and it doesn't show up as a bug until
  someone hands you `k >= 10`.
- Narrate the push/pop contract explicitly: "on `[`, I save the count and the
  string-so-far; on `]`, I restore them and splice." That sentence is the
  whole algorithm, and interviewers are listening for whether you can state
  it before you start typing.
- If asked for the recursive version, be ready to explain the tradeoff: it
  reads slightly closer to "decode one group, recursively decode what's
  inside it," but it's bounded by the language's call stack depth, which the
  explicit-stack version isn't.
- A correct answer that gets there by repeatedly regexing for a
  bracket-with-no-brackets-inside and rebuilding the whole string until none
  remain is real and easy to reach for under pressure, but it redoes work on
  every one of those passes — worth naming as the "obvious first idea" and
  then explaining why the single-pass stack version avoids the rebuilding.
