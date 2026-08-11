# First Unique Character

Given a string, return the index of the first character that appears exactly once
in it. Return `-1` if every character repeats.

The **index** is wanted, not the character.

## Constraints

- `0 <= s.length <= 100000`
- `s` contains only lowercase English letters
- An empty string has no unique character, so the answer is `-1`
- This is a **warm-up**: there is no hidden cost trap here, and the suite checks
  correctness only. Reach for the obvious solution.

## Examples

```
"leetcode"     ->  0    ('l' appears once, and first)
"loveleetcode" ->  2    ('v'; 'l' and 'o' both repeat later)
"aabb"         ->  -1
""             ->  -1
"z"            ->  0
```

## Signature

```ts
export function firstUniqChar(s: string): number
```

## Run it

```bash
pnpm test first-unique-char     # attempt
pnpm reset first-unique-char    # start over from a clean stub
```
