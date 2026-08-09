# Range Sum Queries

Given an array `values` and a list of `queries`, answer each query with the sum
of the values in that range.

A query is a pair `[from, to]`, inclusive at both ends.

## Constraints

- `1 <= values.length <= 200000`
- `1 <= queries.length <= 200000`
- `0 <= from <= to < values.length`
- `-10^6 <= values[i] <= 10^6`
- The array does not change between queries
- A solution that adds up each range when the query arrives will be rejected by
  this problem's test suite, even when it returns the correct answers.

## Examples

```
values = [1,2,3,4,5], queries = [[0,2],[1,3],[4,4],[0,4]]
-> [6,9,5,15]

values = [-1,3,-2], queries = [[0,1],[0,2]]
-> [2,0]
```

## Signature

```ts
export function rangeSums(values: number[], queries: [number, number][]): number[]
```

## Run it

```bash
pnpm test range-sum-queries     # attempt
pnpm reset range-sum-queries    # start over from a clean stub
```
