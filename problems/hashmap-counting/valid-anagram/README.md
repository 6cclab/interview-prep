# Valid Anagram

Given two strings `a` and `b`, return `true` if `b` is a rearrangement of `a` —
the same characters, each the same number of times.

## Constraints

- `0 <= a.length, b.length <= 50000`
- Both strings contain only lowercase English letters
- Two empty strings are anagrams of each other
- This is a **warm-up**: there is no hidden cost trap here, and the suite checks
  correctness only. Reach for the obvious solution.

## Examples

```
a = "anagram", b = "nagaram"   ->  true
a = "rat",     b = "car"       ->  false
a = "aa",      b = "a"         ->  false
```

## Signature

```ts
export function isAnagram(a: string, b: string): boolean
```

## Run it

```bash
pnpm test valid-anagram     # attempt
pnpm reset valid-anagram    # start over from a clean stub
```
