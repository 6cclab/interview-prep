# Container With Most Water — worked solution

**Spoilers.** Don't open this until you've either solved
`problems/two-pointers/container-with-most-water/` or given up on it for the
session.

## The observation

Start with the widest possible container: `left = 0`, `right = n - 1`. Its
area is `min(heights[left], heights[right]) * (right - left)`.

Say `heights[left] < heights[right]`. Is there any point moving `right`
inward instead of `left`? No: every container you could form by keeping
`left` fixed and moving `right` to some `right' < right` has width `<= right
- left` (strictly less) and a height capped at `min(heights[left],
heights[right'])`, which is still capped by `heights[left]` — the shorter of
the two original walls. You already know the *width* has shrunk, and the
*height* can be no better than what you already had. So every one of those
containers is dominated by the one you already measured. Nothing is lost by
discarding all of them, i.e. by moving `left` forward instead — the wall that
was limiting you.

That's the whole algorithm: repeatedly measure the container at the current
`left`/`right`, then advance whichever pointer points at the shorter wall
(either one, on a tie). Each step permanently rules out a whole set of
strictly-worse candidates without ever having to visit them individually, so
a single inward sweep from both ends covers the search space in `O(n)`.

## Reference solution

```ts
export function maxArea(heights: number[]): number {
  const n = heights.length
  let left = 0
  let right = n - 1
  let best = 0
  while (left < right) {
    const h = Math.min(heights[left]!, heights[right]!)
    const area = h * (right - left)
    if (area > best) best = area
    if (heights[left]! < heights[right]!) left++
    else right--
  }
  return best
}
```

## Complexity

- Time: `O(n)` — each pointer moves at most `n` times total, and the loop
  ends when they meet.
- Space: `O(1)`.

## Why it's correct

Every pair `(i, j)` with `i < j` gets implicitly ruled out the moment the
pointer sitting on its shorter wall advances past it — and the argument above
shows that's always safe, because the pair that was just measured strictly
dominates every pair `(i, j)` could have improved on from that position. Since
`left` and `right` only move toward each other and the loop runs until they
meet, every index pair is either explicitly measured or provably dominated by
one that was. No pair with a better area is ever skipped.

## Sibling problems (same pattern)

- **Two Sum II — Input Array Is Sorted**: given a sorted array, find two
  numbers summing to a target. Same shape: move the pointer whose sum
  contribution is wrong in the needed direction.
- **3Sum**: fix one index, then run the two-pointer sweep on the rest for
  each fixed index.
- **Trapping Rain Water**: also converges two pointers inward, but tracks a
  running max height from each side instead of a single area — a good
  next step once this one feels easy.
- **Valid Palindrome / reverse-in-place style problems**: not the same
  optimization argument, but the same "advance the end that's known to be
  safe" pointer discipline.

## The tell

Look for: an array where the answer is defined over a *pair* of positions,
the "cost" of a pair depends on both a value at each end and the distance
between them, and there's some monotone reason that starting from the
extremes and narrowing is safe — i.e. you can prove that moving one specific
side (not both, not arbitrarily) never loses the optimum. If you can state
that domination argument out loud in one sentence, it's this pattern, not a
harder search.

## Interview notes

- Say the domination argument before writing code. It's the entire
  justification for why the pointer move is safe, and interviewers are
  listening for it specifically — the two-line implementation alone doesn't
  demonstrate you understand why it works.
- Common bug: advancing the wrong pointer, or advancing both every
  iteration. Only the pointer at the shorter wall can be safely advanced;
  advancing the taller one throws away containers you haven't ruled out.
- Ties (`heights[left] === heights[right]`) can advance either pointer —
  both are safe, since the domination argument applies symmetrically at a
  tie.
- Watch for `heights[i] === 0`: it never wins (area is always 0 through it)
  but it's a completely ordinary value to the algorithm — no special case
  needed, it just gets walked past like anything else.
