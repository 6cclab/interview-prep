# Valid Palindrome

Given a string `text`, decide whether it reads the same forwards and backwards,
considering only letters and digits and ignoring case.

## Constraints

- `0 <= text.length <= 200000`
- `text` may contain any printable ASCII characters
- Characters that are not letters or digits are skipped entirely
- The empty string, and a string with no letters or digits at all, are
  palindromes
- This is a **warm-up**: there is no hidden cost trap here, and the suite checks
  correctness only. Reach for the obvious solution.

## Examples

```
text = "A man, a plan, a canal: Panama"   ->  true
text = "race a car"                       ->  false
text = " "                                ->  true
text = "0P"                               ->  false
```

## Signature

```ts
export function isPalindrome(text: string): boolean
```

## Run it

```bash
pnpm test valid-palindrome     # attempt
pnpm reset valid-palindrome    # start over from a clean stub
```
