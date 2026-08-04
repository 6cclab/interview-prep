# Group Anagrams — worked solution

**Spoilers.** See `rules/no-spoilers.md`.

## The observation

Two words are anagrams of each other exactly when they have the same
multiset of letters — same letters, same counts, order doesn't matter. That
means every word has a **canonical form** that is identical for it and for
every one of its anagrams, and different for anything that isn't an anagram
of it. If you can compute that canonical form cheaply, grouping stops being
a comparison problem (compare word A to word B, to C, to D, ...) and becomes
a bucketing problem: compute each word's canonical form once, and drop it in
the bucket keyed by that form. One pass, one map, done — no word is ever
compared directly against another word at all.

Two canonical forms work:

1. **Sorted letters.** Sort each word's characters into a fixed order (e.g.
   `"eat"` and `"ate"` both sort to `"aet"`). Two words are anagrams iff
   their sorted forms are equal, by definition of what sorting does to a
   multiset.
2. **26-slot count signature.** Count how many times each of `a`-`z`
   appears (e.g. as a 26-length array or a compact string like
   `a1b0c0...`). Two words are anagrams iff their count vectors are equal —
   again by definition, since "same multiset of letters" *is* "same count
   per letter."

## Reference solution (count signature)

```ts
export function groupAnagrams(words: string[]): string[][] {
  const groups = new Map<string, string[]>()

  for (const word of words) {
    const counts = new Array(26).fill(0)
    for (let i = 0; i < word.length; i++) {
      counts[word.charCodeAt(i) - 97]++
    }
    const key = counts.join(',')

    const group = groups.get(key)
    if (group) group.push(word)
    else groups.set(key, [word])
  }

  return [...groups.values()]
}
```

A sorted-letters version is just as valid — swap the key computation for
`[...word].split('').sort().join('')` (or equivalent) and the rest is
identical. Both pass every test in this drill; only their constants differ.

## Complexity

Let `n` = number of words, `k` = max word length.

- **Sorted-letters key:** building each key is `O(k log k)` (a sort), so the
  whole pass is `O(n · k log k)`.
- **Count-signature key:** building each key is `O(k + 26)` = `O(k)`
  (one pass to count, one pass to serialize a fixed-size array), so the
  whole pass is `O(n · k)`.

Both dominate the brute-force pairwise comparison's `O(n^2 · k)` once `n` is
large relative to `log k` — which it almost always is, since word lengths
in practice are small and bounded while `n` is not. The count signature
wins over sorting whenever `k` is large enough that `log k` matters, i.e.
long words; for the short words typical of this problem (English words,
`k` well under 100) the two are close enough in practice that either is a
reasonable answer in an interview. The count signature is the one worth
defaulting to, because it removes a `log k` factor for free and because
"count each letter" generalizes to other counting-signature problems (see
below) where sorting doesn't apply at all.

## Why counts, not sets

A tempting shortcut is to key on *which* letters appear — e.g.
`new Set(word)` or a 26-bit bitmask of letters present — instead of how many
times each appears. That's wrong: `"aab"` and `"abb"` both use exactly the
letters `{a, b}`, so a letter-*set* key treats them as anagrams. They are
not — `"aab"` has two `a`s and one `b`; `"abb"` has one `a` and two `b`s. You
cannot rearrange one into the other. Anagram-ness is defined by the full
multiset (how many of each letter), not by the support set (which letters
show up at all). This is exactly what the `["aab", "aba", "abb"]` test in
this drill's suite is checking: `"aab"` and `"aba"` share counts (`a:2,
b:1`) and are anagrams; `"abb"` (`a:1, b:2`) is not an anagram of either,
despite using the identical set of letters.

## Sibling problems

The same move — replace "compare every pair" with "compute a cheap
canonical/counting key once per item, then bucket or look up by that key" —
shows up any time the thing you're checking is really an equality-up-to-some-
transformation:

- **Valid Anagram** (single pair, not a grouping): same count-signature
  idea, just compare two signatures instead of bucketing many.
- **Two Sum / frequency-of-complement problems:** bucket by value seen so
  far instead of scanning the rest of the array for a match.
- **First unique / duplicate detection:** count occurrences once, then a
  second pass answers "have I seen this exact count profile before" in
  O(1) per item instead of an O(n) rescan.

The common thread in this pattern is: whenever "compare against everything
else" is on the table, ask whether there's a cheap-to-compute key that makes
equal-under-the-real-rule items collide, and reach for a hash map before
reaching for a nested loop.

## The tell

The giveaway in the prompt is "group items that are equivalent under some
transformation of their contents" combined with an input size that makes an
`O(n^2)` pairwise scan the naive first instinct. Anywhere you'd otherwise
write "compare item A to item B, item A to item C, ..." — stop and ask
whether A and B being "the same" can be reduced to two cheap values being
equal. If so, compute that value once per item and let a hash map do the
comparing.

## Interview notes

- State the canonical-form observation explicitly before coding — it's the
  whole solution; the map is just bookkeeping.
- Mention both key choices (sorted vs. count signature) and their
  complexity tradeoff; picking the count signature and explaining *why* (no
  `log k` factor) reads as more senior than defaulting to sort without
  comment.
- If asked to extend to Unicode/non-lowercase input, the count-signature
  version needs to swap the fixed 26-slot array for a `Map<string, number>`
  or similar — flag that the fixed-alphabet assumption is baked into the
  array size, so it's an easy thing to get bitten by if the constraints
  change.
- Watch for the letter-set trap out loud — naming it before an interviewer
  has to point it out is a good signal.
