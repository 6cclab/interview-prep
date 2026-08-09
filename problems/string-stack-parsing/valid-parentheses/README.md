# Valid Parentheses

Given a string `text` containing only the characters `(`, `)`, `[`, `]`, `{`
and `}`, decide whether the brackets are balanced.

Balanced means every opening bracket is closed by the matching kind, and
closings happen in the right order — an opening bracket may only be closed
once everything opened after it has been closed.

## Constraints

- `0 <= text.length <= 200000`
- `text` contains only the six bracket characters
- The empty string is balanced
- A solution that repeatedly scans the string removing adjacent matched pairs
  will be rejected by this problem's test suite, even when it returns the
  correct answer.

## Examples

```
text = "()[]{}"
-> true

text = "([{}])"
-> true

text = "(]"
-> false

text = "([)]"
-> false        (the ( is closed before the [ it contains)

text = "("
-> false
```

## Signature

```ts
export function isBalanced(text: string): boolean
```

## Run it

```bash
pnpm test valid-parentheses     # attempt
pnpm reset valid-parentheses    # start over from a clean stub
```
