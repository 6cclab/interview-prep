# First Unique Character — worked solution

## The tell

Judging position `i` requires a fact about the *whole* input — whether this
character appears again anywhere, including behind you. You cannot decide at `i`
on a single forward pass, and noticing that is the whole insight: it means two
passes, not one clever one.

## The observation

Pass one builds the counts. Pass two walks the string **in index order** and
returns the first index whose count is 1. The second pass has to be in order,
because "first" is about position, not about the count table — iterating the
table instead gives you *a* unique character, in whatever order the map happens
to yield, which is not the question.

The tempting wrong answer is `s.indexOf(c) === s.lastIndexOf(c)` per character.
That one is actually correct; the wrong variant is checking only whether the
character reappears *later* (`s.indexOf(c, i + 1) === -1`), which returns the
last occurrence of a repeated character. `"cabbac"` catches it: at index 5 the
`c` has nothing after it, so that check answers 5 where the truth is -1.

## Reference solution

```ts
export function firstUniqChar(s: string): number {
  const counts = new Map<string, number>()
  for (const ch of s) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1)
  }
  for (let i = 0; i < s.length; i += 1) {
    if (counts.get(s[i]!) === 1) return i
  }
  return -1
}
```

With the alphabet fixed at 26 lowercase letters, a `number[]` of length 26
indexed by `charCodeAt(i) - 97` replaces the map and is worth mentioning as the
constant-factor version — but reach for the map first. It is correct for any
alphabet and does not depend on remembering that `'a'` is 97.

## Cost

Time O(n) — two passes. Space O(k) where k is the alphabet size, so O(1) here:
at most 26 entries however long the string is. Saying "O(1) space because the
alphabet is bounded" is the answer being listened for; "O(n) space for the map"
suggests you have not noticed the bound.
