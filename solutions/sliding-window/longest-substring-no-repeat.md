# Longest Substring Without Repeating Characters — worked solution

**Spoilers.** See `prompts/rules/no-spoilers.md`.

## The observation

Fix the left edge of a candidate window and grow the right edge one
character at a time. As long as the new character hasn't appeared since the
left edge, the window is still valid and the answer only ever improves by
extending it. The moment the new character has appeared *inside the current
window*, the window is broken — but not entirely: you don't need to throw
the whole window away and restart just past the old left edge. You need to
throw away only the prefix up to and including the previous occurrence,
because every substring that starts before that occurrence and reaches the
new right edge necessarily contains the duplicate.

That gives the shape: track, for every character, the index it was last
seen at. When the right edge lands on a character last seen at index `p`,
and `p` is at or after the current left edge, jump the left edge to `p + 1`.
Otherwise leave it alone — a stale sighting from before the current window
doesn't invalidate anything.

The left edge is monotonically non-decreasing. It never needs to move
backward, because once a character has been excluded from the window by a
left-edge jump, re-including it can only reintroduce a duplicate the jump
was there to prevent. That monotonicity is what makes a single left-to-right
pass sufficient — each index is visited by the right edge exactly once, and
the left edge's total movement across the whole string is bounded by the
string's length, not by the number of times it's evaluated.

The part that's easy to get wrong: naively writing "jump left edge to
previous-occurrence + 1" without the `>= left` guard corrupts the invariant.
If a character's last recorded occurrence is *before* the current window
(because the window has already moved past it), jumping left there would
move the left edge **backward**, which can never happen in a correct
solution and will silently inflate the answer. `"abba"` is the smallest
fixture that catches this: the last `'a'` was seen at index 0, which is
before the left edge by the time the right edge reaches it a second time
(the left edge already jumped to index 2 after the second `'b'` forced it
there). A solution that jumps unconditionally moves the left edge from 2
back to 1, and reports 3 instead of 2.

## Reference solution

```ts
export function lengthOfLongestSubstring(s: string): number {
  const lastSeen = new Map<string, number>()
  let best = 0
  let left = 0
  for (let right = 0; right < s.length; right++) {
    const c = s[right]!
    const prev = lastSeen.get(c)
    if (prev !== undefined && prev >= left) {
      left = prev + 1
    }
    lastSeen.set(c, right)
    if (right - left + 1 > best) best = right - left + 1
  }
  return best
}
```

## Complexity

O(n) time, O(min(n, alphabet size)) space. The right edge visits each index
once; the map holds at most one entry per distinct character seen so far.

## Why it's correct

Invariant: at the top of each iteration of the loop, `[left, right)` (the
window before this character is considered) contains no repeated
characters, and `left` is the smallest valid start for a window ending
before `right`. Extending to include `s[right]` either preserves that
invariant (character not seen since `left`) or is repaired by advancing
`left` past the previous occurrence — the smallest advance that restores
"no duplicates in `[left, right]`". Because `left` only advances, it's
never re-including something a previous advance excluded, so the invariant
holds by induction and `best` at any point is the true best over all
windows ending at or before `right`.

## Sibling problems (same pattern)

- Longest substring with at most K distinct characters — same left/right
  edges, the trigger for shrinking is a distinct-character count instead of
  a single duplicate.
- Minimum window substring — grow right until a target is satisfied, then
  shrink left as far as possible while it stays satisfied; the mirror image
  of this problem's shrink condition.
- Longest repeating character replacement — the "constraint" becomes
  `(window length - count of most frequent char) <= k`, but the grow/shrink
  skeleton is identical.

## The tell

Contiguous substring or subarray, with some constraint that can be violated
by extending too far, and a request for a length/count/min/max rather than
the substring itself. Any time the phrase "no repeated" or "at most K
distinct" or "sum at most X" is attached to *contiguous*, reach here first.

## Interview notes

- State the invariant out loud before coding: "the window
  `[left, right)` never contains a duplicate." It's easy to lose track of
  whether `right` is inclusive or exclusive mid-derivation; picking one
  and saying it prevents an off-by-one from creeping in silently.
- The `"abba"` trap is the single most common bug in this family: guarding
  the left-edge jump with `prev >= left` (not just `prev !== undefined`) is
  the whole fix. If an interviewer's test case is short and has a repeated
  character that reappears *after* an intervening different repeat, they
  are very likely probing for exactly this.
- Mention the space/time tradeoff of `Map<char, index>` vs. a fixed-size
  array keyed by character code when the alphabet is known and small (e.g.
  ASCII) — the array avoids hashing overhead, but the map generalizes to
  arbitrary Unicode input without assuming an alphabet size up front.
