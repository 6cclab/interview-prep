# Find the Celebrity — worked solution

> Spoiler. `.claude/rules/no-spoilers.md` forbids reading this into context
> unless Andre explicitly asks for it.

## The observation

Ask `knows(a, b)` once. Either answer eliminates somebody **permanently**:

- `true` — `a` knows somebody, so `a` is not the celebrity.
- `false` — somebody fails to know `b`, so `b` is not the celebrity.

One question, one candidate gone, forever. That is the whole problem. `n - 1`
questions leave exactly one survivor.

The survivor is only a *candidate*. Elimination proves everybody else is
disqualified; it does not prove this one qualifies. So verify.

## Solution

```ts
export function findCelebrity(
  n: number,
  knows: (a: number, b: number) => boolean,
): number {
  let candidate = 0
  for (let other = 1; other < n; other++) {
    if (knows(candidate, other)) candidate = other
  }

  for (let other = 0; other < n; other++) {
    if (other === candidate) continue
    if (knows(candidate, other) || !knows(other, candidate)) return -1
  }

  return candidate
}
```

## Complexity

- **Time:** O(n). Pass one is `n - 1` calls; pass two is at most `2(n - 1)`.
  Under `3n`, which is what the budget test asserts.
- **Space:** O(1).

## Why the first pass is safe

The obvious worry is that reassigning `candidate` discards somebody who was
actually the celebrity. It cannot. `candidate` is only replaced when
`knows(candidate, other)` is true, which disqualifies the outgoing candidate on
the spot. And anybody skipped over was disqualified when a later comparison
found somebody who didn't know them.

## Variants that share this pattern

- **Boyer–Moore majority vote** — a counter, and a differing element cancels a
  candidate. Same shape: one comparison discards work permanently, then a
  verification pass, because a "majority" candidate may not have a majority.
- **Tournament minimum/maximum** — pairwise comparison halves the field.
- **Two-pointer container-with-most-water** — moving the shorter wall is safe
  because every pairing with it is already dominated.

## The tell

You are handed an expensive comparison, and a single comparison result rules
somebody out for good. Reach for a candidate variable and one linear pass, then
**verify** — the elimination pass alone is never sufficient.

## Interview notes

- State the O(n²) approach in one sentence, then say you can do better, then
  find the invariant. Do not code the brute force.
- Say the verification pass out loud *before* writing it. Skipping it is the
  single most common failure on this problem, and interviewers watch for it.
- Handle `n = 1` explicitly when asked; the loops already return `0` for it.
