# Decode String

You are given an encoded string `s`. Decode it and return the result.

The encoding rule is `k[encoded_string]`, meaning the `encoded_string` inside
the square brackets should be repeated exactly `k` times, and the resulting
text takes its place. Encodings may be nested: the `encoded_string` inside a
`k[...]` can itself contain more `k[...]` blocks.

## Constraints

- `1 <= s.length <= 300000`
- `k` is always a positive integer. It may be more than one digit — for
  example `12[a]` means `a` repeated 12 times, not `1[a]` followed by `2[a]`.
- `s` is always a valid encoding: brackets are balanced, every `k` is
  immediately followed by exactly one `[...]` group, and there is no
  whitespace.
- Outside of the digits that make up a `k`, the only characters that appear
  are lowercase English letters (`a`-`z`) and the brackets `[` and `]`. The
  decoded content itself never contains digits.
- The decoded result is guaranteed to fit comfortably in memory.
- A solution that produces the correct string will still be rejected by this
  problem's test suite if it gets there by repeatedly scanning the string for
  a bracketed group and rebuilding the whole string around it, pass after
  pass, until no brackets remain.

## Examples

```
s = "3[a]"
-> "aaa"

s = "3[a2[c]]"
-> "accaccacc"

s = "2[abc]3[cd]ef"
-> "abcabccdcdcdef"

s = "12[a]"
-> "aaaaaaaaaaaa"           (12 a's)

s = "2[a2[b]c]"
-> "abbcabbc"
```

## Signature

```ts
export function decodeString(s: string): string
```

## Run it

```bash
pnpm test decode-string     # attempt
pnpm reset decode-string    # start over from a clean stub
```
