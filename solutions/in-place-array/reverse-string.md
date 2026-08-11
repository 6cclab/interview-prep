# Reverse String — worked solution

## The tell

"In place" plus a symmetric transformation. Nothing about position `i` matters
except where it lands relative to the other end, so the two ends are what you
track.

## The observation

Element `i` swaps with element `n - 1 - i`. Do that for `i` from `0` while
`i < n / 2` — or, equivalently, walk two cursors inward from the ends until they
meet. The two formulations are the same work; the cursor version is harder to get
wrong because there is no arithmetic to fumble.

The only real trap is the stopping condition. Running the loop over the whole
array instead of half of it swaps every pair twice and leaves the array exactly
as it started — a bug that looks like nothing happened.

## Reference solution

```ts
export function reverseString(chars: string[]): void {
  let lo = 0
  let hi = chars.length - 1
  while (lo < hi) {
    const tmp = chars[lo]!
    chars[lo] = chars[hi]!
    chars[hi] = tmp
    lo += 1
    hi -= 1
  }
}
```

`lo < hi` handles both odd and even lengths without a special case: at odd
length the two cursors land on the same index and the loop stops, which is
correct, because the middle element stays put.

## The built-in, and why the prompt forbids it

`chars.reverse()` is the correct answer to the *question* and passes the whole
suite — it mutates in place and returns the same reference, so the caller sees the
reversal. In real code that is what you should write.

It is off limits here because the drill is the index arithmetic, and because one
mistake about it is common enough to be worth meeting deliberately:
`chars = chars.reverse()` also passes, and the assignment does nothing. It only
gets written by someone who believes `reverse()` returns a *new* array — and under
that belief the code is wrong. Swap in `toReversed()`, the non-mutating ES2023
counterpart, and the caller sees nothing change.

JS array methods split two ways: mutating (`reverse`, `sort`, `splice`, `push`)
and copying (`toReversed`, `toSorted`, `slice`, `map`). The mutating ones return
`this` purely so they can be chained. Assigning the result of a mutating method
back to its own variable is the tell that the split has not landed.

In an interview, say it: "I'd reach for `chars.reverse()` — I assume you want it by
hand." Then write the loop.

## Cost

Time O(n) — each element is touched once. Space O(1) — two indices and a
temporary, regardless of input size. Building a reversed copy and assigning it
back would also be O(n) time but O(n) space, and `chars = [...]` inside the
function would not be visible to the caller at all.
