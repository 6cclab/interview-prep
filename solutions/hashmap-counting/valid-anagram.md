# Valid Anagram — worked solution

> **Spoilers.** Do not read this during an attempt.

> Warm-up tier: correctness only. There is no cost trap here.

## The observation

An anagram is a claim about *counts*, not order. Count each character in the
first string, then spend those counts down with the second. If a count ever goes
negative, or anything is left over at the end, they are not anagrams.

The length check first is not an optimisation, it is the cheap half of the
correctness: unequal lengths can never be anagrams, and having it up front means
"nothing left over" reduces to "nothing went negative."

## Reference solution

```ts
export function isAnagram(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  const counts = new Map<string, number>()
  for (const ch of a) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  for (const ch of b) {
    const left = counts.get(ch)
    if (left === undefined || left === 0) return false
    counts.set(ch, left - 1)
  }
  return true
}
```

Sorting both strings and comparing is also correct and often the better answer to
give out loud first — it is one line, obviously right, and O(n log n). Counting is
O(n); say both and name the trade.

Since the input is stated as lowercase letters only, a 26-element array beats a
Map on constant factors. Mention it; do not open with it, because it stops being
correct the moment the constraint widens to Unicode.

## Cost

Time O(n), space O(k) where k is the alphabet size — O(1) under the stated
constraint. Sorting is O(n log n) time.

## The tell

**"Same characters", "rearrangement", "permutation of".** Any claim about
multiset equality is a counting problem. The trap is reaching for a `Set`, which
loses the counts and calls `aab` and `abb` anagrams.
