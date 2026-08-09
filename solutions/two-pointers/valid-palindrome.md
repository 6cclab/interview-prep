# Valid Palindrome — worked solution

> **Spoilers.** Do not read this during an attempt.

> Warm-up tier: correctness only. There is no cost trap here.

## The observation

A palindrome is a claim about pairs equidistant from the centre, so compare from
both ends inwards. The only complication is the filtering, and the clean way to
handle it is to advance each pointer past anything that is not a letter or digit
*before* comparing, rather than building a cleaned copy first.

Building the cleaned string first is also perfectly correct and easier to get
right — it is O(n) extra space instead of O(1), and that is the only difference.
Say which one you are doing and why.

## Reference solution

```ts
function isAlphanumeric(ch: string): boolean {
  return /[a-z0-9]/i.test(ch)
}

export function isPalindrome(text: string): boolean {
  let lo = 0
  let hi = text.length - 1
  while (lo < hi) {
    while (lo < hi && !isAlphanumeric(text[lo]!)) lo++
    while (lo < hi && !isAlphanumeric(text[hi]!)) hi--
    if (text[lo]!.toLowerCase() !== text[hi]!.toLowerCase()) return false
    lo++
    hi--
  }
  return true
}
```

Both inner loops need the `lo < hi` guard, not just a bounds check — without it a
string of pure punctuation walks a pointer off the end.

`toLowerCase()` and not arithmetic on character codes. `'0'` is 48 and `'P'` is
80 — exactly 32 apart, which is the same distance as `'A'` and `'a'`. So any
case-insensitive comparison built on "differ by 32" rather than on character
class calls those two equal. The suite tests `'0P'` for exactly that.

## Cost

Time O(n), space O(1). The cleaned-copy version is O(n) space.

## The tell

**Symmetry, or a comparison between the two ends of something.** Two pointers
converging is the shape; the transferable habit is noticing that a filtering rule
can be applied *while* scanning rather than in a separate pass, which is what
turns O(n) extra space into O(1).
