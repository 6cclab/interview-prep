# Find the Celebrity

There are `n` people at a party, labelled `0` through `n - 1`.

Exactly one of them may be a **celebrity**, defined by two properties:

1. The celebrity knows nobody at the party.
2. Everybody else at the party knows the celebrity.

You are given `n` and a helper `knows(a, b)` which returns `true` if and only if
person `a` knows person `b`.

Return the label of the celebrity, or `-1` if there isn't one.

## Constraints

- `1 <= n <= 5000`
- `knows(a, b)` is **expensive**. A solution that asks about every pair is too slow
  and this problem's test suite will reject it, even if it returns the right answer.
- Everybody knows themselves; `knows(a, a)` is always `true`.
- There is at most one celebrity.

## Examples

```
n = 2, knows = { 0 knows 1, 1 knows nobody but itself }
-> 1

n = 3, everybody knows only themselves
-> -1        (nobody is known by the others)

n = 1
-> 0         (vacuously: knows nobody else, and nobody else fails to know them)
```

## Signature

```ts
export function findCelebrity(
  n: number,
  knows: (a: number, b: number) => boolean,
): number
```

## Run it

```bash
pnpm test celebrity     # attempt
pnpm reset celebrity    # start over from a clean stub
```
