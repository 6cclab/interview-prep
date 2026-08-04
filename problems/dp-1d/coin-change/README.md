# Coin Change

You're given an array `coins` of distinct positive coin denominations and a
target `amount`. Each denomination is available in **unlimited supply** — you
can use any coin as many times as you like.

Return the **fewest number of coins** whose values sum exactly to `amount`.
If no combination of coins sums to `amount`, return `-1`.

`amount = 0` requires `0` coins — that's not an error case, it's the base
case.

## Constraints

- `1 <= coins.length <= 20`
- `1 <= coins[i] <= 10^4`, all distinct, order not guaranteed
- `0 <= amount <= 10^4`
- A solution that returns the correct count but explores every combination
  of coins without reusing work across amounts will be rejected by this
  problem's test suite, even when every answer it returns is correct.

## Examples

```
coins = [1, 2, 5], amount = 11
-> 3        (5 + 5 + 1)

coins = [2], amount = 3
-> -1       (3 is odd, only even totals are reachable)

coins = [1, 3, 4], amount = 6
-> 2        (3 + 3 — note this beats 4 + 1 + 1)

coins = [7], amount = 0
-> 0
```

## Signature

```ts
export function coinChange(coins: number[], amount: number): number
```

## Run it

```bash
pnpm test coin-change     # attempt
pnpm reset coin-change    # start over from a clean stub
```
