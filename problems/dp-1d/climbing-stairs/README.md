# Climbing Stairs

You are climbing a staircase of `n` steps. Each move takes you up either 1 step
or 2 steps. How many distinct sequences of moves reach the top?

Two sequences are the same only if they take the same moves in the same order,
so on a staircase of 3 the answer is 3: `1+1+1`, `1+2`, `2+1`.

## Constraints

- `1 <= n <= 77`
- The answer always fits in a JavaScript safe integer
- A solution that re-derives each subproblem from scratch will be rejected by
  this problem's test suite, even when it returns the correct answer.

## Examples

```
n = 1  ->  1        (1)
n = 2  ->  2        (1+1, 2)
n = 3  ->  3        (1+1+1, 1+2, 2+1)
n = 4  ->  5
```

## Signature

```ts
export function countWays(n: number): number
```

## Run it

```bash
pnpm test climbing-stairs     # attempt
pnpm reset climbing-stairs    # start over from a clean stub
```
