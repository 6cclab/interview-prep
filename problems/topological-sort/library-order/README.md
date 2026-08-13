# Library Initialization Order

A service loads a set of libraries at startup. Some libraries must be fully
initialized before others can be, and each library declares which ones it
depends on.

Given the libraries and the dependency relationships, return an order in which
they can safely be initialized: every library appears after all of the
libraries it depends on.

```ts
initOrder(['a', 'b'], [['a', 'b']])   // 'a' depends on 'b'  ->  ['b', 'a']
```

Read each pair `[x, y]` as **"x depends on y"**, so `y` must come first.

## When there is no valid order

Return `null`. Two things make an order impossible:

- **A cycle.** `a` depends on `b` and `b` depends on `a`.
- **An unknown dependency.** A pair names something that is not in the library
  list, so it can never be initialized and neither can anything needing it.

## Details that are easy to get wrong

- **Several valid orders usually exist**, and any of them is correct. The test
  suite checks that your order satisfies every dependency, not that it matches
  one particular answer.
- **A pair may be listed more than once.** Duplicates are redundant, not an
  error, and must not make a library appear twice or shift its position.
- **The graph is usually disconnected.** Libraries with no dependencies at all,
  and whole clusters unrelated to each other, are normal. Every library in the
  input must appear in the output exactly once.
- The list may be empty. So may the dependency list.

## Constraints

- `1 <= libraries.length <= 200000`
- `0 <= dependencies.length <= 400000`
- Library names are unique, non-empty strings
- A solution that repeatedly rescans the remaining libraries looking for one
  whose dependencies are all satisfied is correct, and will be rejected by
  this problem's test suite on cost.

## Examples

```
initOrder(['app', 'http', 'log'], [['app','http'], ['app','log'], ['http','log']])
-> ['log', 'http', 'app']        the only valid order here

initOrder(['a','b','c','d'], [['b','a'], ['d','c']])
-> e.g. ['a','c','b','d']        two independent pairs; many orders work

initOrder(['a','b'], [['a','b'], ['b','a']])
-> null                          cycle

initOrder(['a'], [['a','ghost']])
-> null                          'ghost' is not a known library

initOrder(['a','b'], [['a','b'], ['a','b']])
-> ['b','a']                     duplicate pair, still one 'a' and one 'b'
```

## Signature

```ts
export function initOrder(
  libraries: string[],
  dependencies: Array<[string, string]>,
): string[] | null
```

## Run it

```bash
pnpm test library-order     # attempt
pnpm reset library-order    # start over from a clean stub
```
