# Group Anagrams

You are given an array of lowercase strings, `words`. Two words are
**anagrams** of each other if one can be rearranged into the other — they
contain exactly the same letters, the same number of times, just in a
different order.

Group the words so that every word ends up in exactly one group, and two
words land in the same group if and only if they are anagrams of each other.
Return the groups.

The order of the groups, and the order of words within a group, does not
matter. A single word with no anagrams elsewhere in the input still forms
its own group of one.

## Constraints

- `0 <= words.length <= 100000`
- `0 <= words[i].length <= 100`
- Every character in every word is a lowercase English letter (`a`-`z`);
  words may be empty strings.
- A solution that checks every word against every other word will be
  rejected by this problem's test suite, even when it returns the correct
  grouping.

## Examples

```
words = ["eat","tea","tan","ate","nat","bat"]
-> [["eat","tea","ate"], ["tan","nat"], ["bat"]]
   (any order of groups, and any order of words within a group, is accepted)

words = []
-> []

words = ["hello"]
-> [["hello"]]

words = [""]
-> [[""]]
```

## Signature

```ts
export function groupAnagrams(words: string[]): string[][]
```

## Run it

```bash
pnpm test group-anagrams     # attempt
pnpm reset group-anagrams    # start over from a clean stub
```
