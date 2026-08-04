# Longest Substring Without Repeating Characters

Given a string `s`, return the length of the longest substring of `s` that
contains no repeated characters.

A substring is contiguous — you cannot skip characters or reorder them.

## Constraints

- `0 <= s.length <= 5 * 10^4`
- `s` may contain any printable character, not just lowercase letters.
- A solution that checks every substring will be rejected by this problem's
  test suite, even if it returns the right answer.

## Examples

```
s = "abcabcbb"
-> 3            ("abc")

s = "bbbbb"
-> 1            ("b")

s = "pwwkew"
-> 3            ("wke")

s = ""
-> 0
```

## Signature

```ts
export function lengthOfLongestSubstring(s: string): number
```

## Run it

```bash
pnpm test longest-substring-no-repeat     # attempt
pnpm reset longest-substring-no-repeat    # start over from a clean stub
```
