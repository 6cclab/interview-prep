# Coin Change — worked answer

**Spoilers.** See `rules/no-spoilers.md`.

## The observation

Define `best(a)` as the fewest coins that sum to `a`. For `a > 0`, any valid
combination ends with some last coin `c`. Remove it and what's left is a
valid combination for `a - c`, so:

```
best(a) = 1 + min over coins c <= a of best(a - c)
best(0) = 0
best(a) = infinity if no coin combination reaches a
```

The key thing to notice: `best(a - c)` for a given amount gets asked for
repeatedly — `best(10)` is needed by `best(11)` via a `1`-coin, by `best(12)`
via a `2`-coin, by `best(15)` via a `5`-coin, and so on. The naive recursive
form re-derives `best(10)` from scratch every single time it's asked for,
and the number of times it's asked for grows exponentially with `amount`.
Since each amount only has one true answer, solving it once and reusing that
answer for every amount downstream collapses the tree into a table with one
entry per amount.

## Reference solution (bottom-up table)

```ts
export function coinChange(coins: number[], amount: number): number {
  const best = new Array<number>(amount + 1).fill(Infinity)
  best[0] = 0
  for (let a = 1; a <= amount; a++) {
    for (const c of coins) {
      if (c > a) continue
      const candidate = best[a - c]! + 1
      if (candidate < best[a]!) best[a] = candidate
    }
  }
  return best[amount] === Infinity ? -1 : best[amount]!
}
```

Complexity: `O(amount * coins.length)` time, `O(amount)` space. Each of the
`amount + 1` table entries does one pass over the coin list.

## Why greedy fails

Greedy ("always take the largest coin that still fits") is tempting because
it's exactly right for currency systems like `[1, 5, 10, 25]`. It is not a
general algorithm — it's a property of the specific denominations, and
nothing in the problem statement promises that property.

Worked trace, `coins = [1, 3, 4]`, `amount = 6`:

```
Greedy: sorted desc [4, 3, 1]
  remaining = 6, take 4 -> remaining = 2, count = 1
  remaining = 2, 4 doesn't fit, 3 doesn't fit, take 1 -> remaining = 1, count = 2
  remaining = 1, take 1 -> remaining = 0, count = 3
  Greedy answer: 3 coins (4 + 1 + 1)

Optimal: 3 + 3 = 6, using 2 coins.
```

Taking the biggest coin first locks in a remainder (`2`) that has no
efficient way to be paid off — the two `1`s are individually optimal moves
that combine into a bad one. `best(a)` has to consider *every* last coin at
every amount, including the ones that look locally worse, because a locally
worse choice can lead to a globally better remainder.

## The `-1` / sentinel handling

Unreachable amounts are represented internally as `Infinity` rather than
`-1` while the table is being built. This matters because `-1` is a valid
*count* under normal arithmetic — if unreachable amounts were stored as
`-1`, then `best(a - c) + 1` for an unreachable sub-amount would produce `0`,
which looks like a real, small answer and would poison every amount built on
top of it. `Infinity + 1` stays `Infinity` and never wins a `<` comparison
against a real count, so unreachability propagates correctly through the
whole table. `-1` is only produced once, at the very end, by checking
whether `best[amount]` is still `Infinity`.

## Top-down memo vs. bottom-up table

The recurrence supports either direction:

- **Top-down (memoized recursion)**: keep the recursive `go(remaining)`
  shape from the brute force, but cache each `remaining` the first time it's
  computed and return the cached value on repeat visits. Same asymptotic
  cost as the table, but only computes amounts that are actually reachable
  from the target — useful when `coins` is sparse relative to `amount` and
  many sub-amounts are never visited.
- **Bottom-up (table)**: fill `best[0..amount]` in order, as above. Always
  computes every amount from `0` to `amount`, but avoids recursion depth
  concerns and the (small, constant) overhead of a cache lookup per call.

For this problem's constraints (`amount <= 10^4`) either is fine; the table
is the more common default because coin change usually explores most of the
table anyway.

## Sibling problems

- **Coin Change II** (count the number of *ways* to make `amount`, not the
  minimum count) — same state, different recurrence: it sums over coins
  instead of minimizing, and iterating coins in the outer loop instead of
  amount is what prevents double-counting permutations as distinct
  combinations.
- **Perfect Squares** — identical shape to this problem with the coin list
  fixed to `1, 4, 9, 16, ...` up to `amount`.
- **Minimum Cost Climbing Stairs / House Robber** — the same "table indexed
  by position, each entry built from a small fixed set of earlier entries"
  shape, one level simpler because the earlier entries are always at fixed
  offsets (`i-1`, `i-2`) rather than "whichever coin was used."

## The tell

An optimum ("fewest," "cheapest," "most") over a set of choices, where
making a choice reduces the problem to a smaller instance of *the same
problem*, and that smaller instance keeps getting asked for again by
different paths through the choice space. If you can write the answer for
`amount` as "1 plus the best answer among a few smaller amounts," and two
different partial solutions can land on the same smaller amount, that's the
overlap that makes solving each amount once worth doing.

## Interview notes

- State the recurrence in words before writing code: "the best answer for
  `a` is one more than the best answer for `a` minus some coin." That
  sentence is the whole algorithm; the loop structure follows from it
  mechanically.
- Say out loud why greedy is wrong, even if not asked — it heads off the
  "why not just take the biggest coin" follow-up and shows the difference
  between a rule that happens to work on nice inputs and one that's provably
  correct.
- Mention the `Infinity` sentinel choice explicitly. It's a small detail but
  it's the kind of thing that silently breaks a solution that otherwise
  looks right (using `-1` or `amount + 1` as the sentinel both work if
  handled consistently, but naming the reason matters more than the exact
  choice).
- If asked to also return *which* coins were used, note that it just needs
  one more array tracking which coin was chosen at each `best[a]`, walked
  backward from `amount` to `0` at the end — don't build that unless asked.
