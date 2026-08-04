# Course Order

There are `numCourses` courses, labelled `0` to `numCourses - 1`. You are
given `prerequisites`, where `prerequisites[i] = [a, b]` means you **must
take course `b` before course `a`** — read the pair as "b, then a", not in
list order. For example, `[1, 0]` means course `0` must be taken before
course `1`; it does not mean 1 before 0.

Return an order in which you could take all `numCourses` courses that
satisfies every prerequisite. If no such order exists, return an empty
array.

Any order that satisfies every prerequisite is accepted — there is no single
correct answer, and the test suite does not check for one specific ordering.

## Constraints

- `1 <= numCourses <= 100000`
- `0 <= prerequisites.length <= 5000` (small cases); a much larger, densely
  chained set of prerequisites is used to check performance
- `prerequisites[i].length == 2`, and `0 <= a, b < numCourses`
- Prerequisite pairs may repeat
- A solution that finds a valid order by repeatedly rescanning all
  remaining courses for one whose prerequisites are already satisfied will
  be rejected by this problem's test suite, even when the order it returns
  is valid.

## Examples

```
numCourses = 2, prerequisites = [[1, 0]]
-> [0, 1]        (0 has no prerequisite; 1 requires 0 first)

numCourses = 4, prerequisites = [[1,0],[2,0],[3,1],[3,2]]
-> any order where 0 comes before 1 and 2, and both 1 and 2 come before 3
   e.g. [0, 1, 2, 3] or [0, 2, 1, 3]

numCourses = 2, prerequisites = [[1,0],[0,1]]
-> []            (0 needs 1, and 1 needs 0 — no valid order exists)
```

## Signature

```ts
export function findOrder(
  numCourses: number,
  prerequisites: number[][],
): number[]
```

## Run it

```bash
pnpm test course-order     # attempt
pnpm reset course-order    # start over from a clean stub
```
