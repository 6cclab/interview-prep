# Contains Duplicate

Given an array `values`, return `true` if any value appears at least twice,
and `false` if every value is distinct.

## Constraints

- `1 <= values.length <= 500000`
- `-10^9 <= values[i] <= 10^9`
- The array is in no particular order
- A solution that compares every pair of positions will be rejected by this
  problem's test suite, even when it returns the correct answer.

## Examples

```
values = [1,2,3,1]
-> true

values = [1,2,3,4]
-> false

values = [7]
-> false
```

## Signature

```ts
export function hasDuplicate(values: number[]): boolean
```

## Run it

```bash
pnpm test contains-duplicate     # attempt
pnpm reset contains-duplicate    # start over from a clean stub
```
