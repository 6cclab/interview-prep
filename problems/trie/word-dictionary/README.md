# Word Dictionary

Design a class that supports adding words and then searching for whether a
given string matches any word that was added.

Search strings may contain the character `.`, which matches **any single
character** at that position. All other characters must match exactly.

## Constraints

- Words and search strings use lowercase letters `a`-`z` only, plus `.` is
  allowed in search strings (never in added words).
- `1 <= word.length <= 25` for both `addWord` and `search`.
- The same word may be added more than once.
- A search string must match a stored word's length exactly — a stored word
  that merely starts with the search string does not count as a match.
- A solution that returns correct answers is not automatically accepted:
  this problem's test suite includes a scale test, and a solution that is
  merely correct but too slow will be **rejected** even though every
  correctness check passes.

## Examples

```
addWord("bad")
addWord("dad")
addWord("mad")

search("pad") -> false   // no stored word matches
search("bad") -> true    // exact match
search(".ad") -> true    // '.' matches 'b', 'd', or 'm'
search("b..") -> true    // both dots match 'a' and 'd'
```

```
addWord("a")
search("a") -> true
search(".") -> true
search("aa") -> false    // wrong length, never matches
```

## Signature

```ts
export class WordDictionary {
  addWord(word: string): void
  search(word: string): boolean
}
```

## Run it

```bash
pnpm test word-dictionary     # attempt
pnpm reset word-dictionary    # start over from a clean stub
```
