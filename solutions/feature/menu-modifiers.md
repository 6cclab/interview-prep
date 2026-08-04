# Solution: Menu Modifiers

## Reading the existing conventions first

Before touching `modifier-pricing.ts`, the four existing files establish a pattern
worth naming explicitly, because the whole exercise is matching it:

- **Errors** (`errors.ts`): a single `MenuError` base carrying a machine-readable
  `code`, with `NotFoundError` (`NOT_FOUND`) for lookups and `ValidationError`
  (`VALIDATION_FAILED`, carrying an `issues: readonly string[]`) for anything
  wrong with a request's shape or content.
- **Validation** (`validation.ts`): a pure function that builds up an `issues:
  string[]` array by pushing a message per problem found, then throws *once* at
  the end with all of them joined — never throws on the first problem it finds.
- **Money**: always an integer number of cents (`priceCents`, and by extension
  `priceDeltaCents`), never a float dollar amount.
- **Repository/service split**: repositories only store and fetch; validation and
  business rules live one layer up, in the service (or, here, the pricing
  function).

`priceOrderLine` needs to look like it was written by the same person who wrote
`validateNewItem` — same "collect issues, throw once" shape, same error type,
same code.

## Implementation

```ts
import { ValidationError } from './errors'
import type { MenuItem } from './types'

export type SelectionRule = 'exactly_one' | 'at_most_one' | 'any_number'

export interface ModifierOption {
  readonly id: string
  readonly name: string
  readonly priceDeltaCents: number
}

export interface ModifierGroup {
  readonly id: string
  readonly name: string
  readonly rule: SelectionRule
  readonly minSelections: number
  readonly maxSelections: number
  readonly options: readonly ModifierOption[]
}

export interface ModifierSelection {
  readonly groupId: string
  readonly optionIds: readonly string[]
}

export function priceOrderLine(
  item: MenuItem,
  groups: readonly ModifierGroup[],
  selections: readonly ModifierSelection[],
): number {
  const issues: string[] = []
  const selectionsByGroupId = new Map(selections.map((selection) => [selection.groupId, selection]))
  const groupIds = new Set(groups.map((group) => group.id))

  for (const selection of selections) {
    if (!groupIds.has(selection.groupId)) {
      issues.push(`unknown modifier group: ${selection.groupId}`)
    }
  }

  let deltaCents = 0

  for (const group of groups) {
    const selection = selectionsByGroupId.get(group.id)
    const optionIds = selection?.optionIds ?? []
    const uniqueOptionIds = new Set(optionIds)

    if (uniqueOptionIds.size !== optionIds.length) {
      issues.push(`duplicate option selected in group "${group.name}"`)
    }

    if (optionIds.length < group.minSelections) {
      issues.push(
        `group "${group.name}" requires at least ${group.minSelections} selection(s), got ${optionIds.length}`,
      )
    }
    if (optionIds.length > group.maxSelections) {
      issues.push(
        `group "${group.name}" allows at most ${group.maxSelections} selection(s), got ${optionIds.length}`,
      )
    }

    const optionsById = new Map(group.options.map((option) => [option.id, option]))
    for (const optionId of uniqueOptionIds) {
      const option = optionsById.get(optionId)
      if (!option) {
        issues.push(`unknown option "${optionId}" in group "${group.name}"`)
        continue
      }
      deltaCents += option.priceDeltaCents
    }
  }

  if (issues.length > 0) {
    throw new ValidationError(`invalid modifier selections: ${issues.join('; ')}`, issues)
  }

  return item.priceCents + deltaCents
}
```

## Notes on the decisions that matter

- **Bounds come from `minSelections`/`maxSelections`, not from `rule`.** The
  `rule` field is metadata for display (and for a hypothetical future UI to pick
  a checkbox vs. radio button); the actual gate is the numeric bounds. Deriving
  bounds from `rule` with a switch statement (`exactly_one` → `1..1`, etc.) is a
  tempting shortcut that quietly ignores the `minSelections`/`maxSelections`
  fields the ticket explicitly asked for, and breaks the moment a group like
  "Sauce" (`any_number`, `min: 1, max: 2`) shows up.
- **Missing group entries mean zero selections**, not "skip validation for that
  group." A group with `minSelections: 0` that's absent from `selections` is
  fine; a group with `minSelections: 1` that's absent still needs to produce an
  issue. Look up `selectionsByGroupId.get(group.id)` per known group rather than
  only iterating the caller's `selections` array — iterating only the supplied
  selections is the easy way to miss "the group was required and the caller sent
  nothing for it."
- **Unknown option ids and duplicates are validation issues, not thrown
  `NotFoundError`s.** `NotFoundError` in this codebase is reserved for
  repository lookups by id that come back empty (`MenuService.getItem`). A bad
  option id inside an order request is a shape problem with the request, exactly
  like an empty name or a negative price — it belongs in the same
  `issues`-array/`ValidationError` path as everything else, so a single request
  with three separate problems produces one error with three messages, not
  whichever problem happened to be checked first.
- **Duplicates are collected as an issue, not silently deduped.** Deduplicating
  `optionIds` before validating (so `['opt-bacon', 'opt-bacon']` quietly becomes
  one bacon) is the "helpful" thing to do but changes what the customer asked
  for without telling them; the existing validation style never silently
  corrects input, it always fails loudly and reports the array of issues.
- **Scope.** `priceOrderLine` takes the groups as a parameter rather than
  reading them off `MenuItem` or a new repository. Nothing in the ticket asks
  for group persistence, group reuse across items, or a lookup path — adding one
  would be solving a different, unscoped problem (and would require editing
  `types.ts`/`menu-repository.ts`, which the ticket doesn't call for).

## Verification (recorded results)

### 1. Ships correctly (stub throws `not implemented`)

```
 ✓ feature/menu-modifiers/regression.test.ts (18 tests) 3ms
 ✗ feature/menu-modifiers/feature.test.ts (20 tests | 20 failed) — every failure is
   "Error: not implemented" / "expected error to be instance of ValidationError"

 Test Files  1 failed | 1 passed (2)
      Tests  20 failed | 18 passed (38)
```

### 2. Regression suite has teeth

Careless change made to `src/validation.ts`:

```diff
-  if (input.priceCents <= 0) {
+  if (input.priceCents < 0) {
     issues.push('priceCents must be greater than zero')
   }
```

(A `$0` menu item would now silently pass validation — a plausible off-by-one a
careless implementer makes while "just glancing at" the price check on their way
to the modifier feature.)

Result:

```
 × MenuService.addItem > rejects a zero or negative price
   → expected function to throw an error, but it didn't

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 37 passed (38)
```

Caught immediately. Change reverted; `pnpm test menu-modifiers` returns to the
shipped 18-pass/20-fail state.

### 3. Feature is implementable

With the implementation above in place:

```
 ✓ feature/menu-modifiers/feature.test.ts (20 tests) 2ms
 ✓ feature/menu-modifiers/regression.test.ts (18 tests) 3ms

 Test Files  2 passed (2)
      Tests  38 passed (38)
```

`pnpm typecheck` stayed silent throughout. The stub was then reverted to `throw
new Error('not implemented')` for shipping.
