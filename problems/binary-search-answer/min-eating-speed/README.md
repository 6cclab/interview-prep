# Minimum Eating Speed

Koko has `piles.length` piles of bananas. The `i`-th pile has `piles[i]`
bananas. The guards leave in `h` hours.

Koko picks some integer eating speed `k` (bananas per hour) and eats at that
speed for the whole time. Each hour, she picks one pile and eats `k` bananas
from it. If the pile has fewer than `k` bananas left, she eats all of them and
does not start on another pile during that same hour — the rest of that hour's
capacity is wasted.

Return the **minimum** integer `k` such that Koko can eat all the bananas
within `h` hours.

## Constraints

- `1 <= piles.length <= 10^4`
- `1 <= piles[i] <= 10^10`
- `piles.length <= h <= 10^9` (there are always at least enough hours for one
  pile per hour, so an answer always exists)
- A solution that tries candidate speeds `k = 1, 2, 3, ...` in order until one
  works is too slow, and this problem's test suite will reject it, even if it
  returns the right answer.

## Examples

```
piles = [3,6,7,11], h = 8
-> 4

piles = [30,11,23,4,20], h = 5
-> 30

piles = [30,11,23,4,20], h = 6
-> 23
```

## Signature

```ts
export function minEatingSpeed(piles: number[], h: number): number
```

## Run it

```bash
pnpm test min-eating-speed     # attempt
pnpm reset min-eating-speed    # start over from a clean stub
```
