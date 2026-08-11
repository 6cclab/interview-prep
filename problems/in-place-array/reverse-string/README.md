# Reverse String

Given an array of single characters, reverse it **in place** and return nothing.
The caller inspects the array you were handed, so allocating a second array and
filling it does not count as done.

## Constraints

- `0 <= chars.length <= 100000`
- Each entry is exactly one character
- You must modify the input array itself; the return value is ignored
- **Do the reversal yourself.** `chars.reverse()` and `chars.toReversed()` are
  off limits — the exercise is the index arithmetic, not the result. The suite
  cannot tell the difference, so this one is on your honour, and it is worth
  keeping: an interview asks you to do it by hand having already agreed that the
  built-in exists.
- This is a **warm-up**: there is no hidden cost trap here, and the suite checks
  correctness only. Reach for the obvious solution.

## Examples

```
["h","e","l","l","o"]   ->  ["o","l","l","e","h"]
["a","b"]               ->  ["b","a"]
["x"]                   ->  ["x"]
[]                      ->  []
```

## Signature

```ts
export function reverseString(chars: string[]): void
```

## Run it

```bash
pnpm test reverse-string     # attempt
pnpm reset reverse-string    # start over from a clean stub
```
