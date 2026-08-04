# Rubric: Menu Modifiers

Score each dimension strong / adequate / thin. One sentence of evidence per
rating, pointing at the actual diff.

## 1. Convention match

- **Strong**: `priceOrderLine` reads like it was written by whoever wrote
  `validateNewItem` and `menu-service.ts` — same "build an `issues: string[]`,
  throw once at the end" shape, same `ValidationError`/`code` usage, same
  `readonly` and camelCase conventions, cents-as-integers preserved throughout.
  No new helper module, base class, or abstraction introduced that the existing
  four files don't already use.
- **Adequate**: Gets the error type and general shape right but throws early on
  the first problem found instead of collecting every issue, or introduces a
  small stylistic wobble (e.g. a differently-shaped return value, a `class`
  where the rest of the codebase uses plain functions).
- **Thin**: Recognizable as "trying to match the style" but does something
  clearly foreign — a `Result<T, E>` return type, a different error class
  hierarchy, or console logging where the rest of the codebase never logs.

## 2. Error handling

- **Strong**: Every invalid-selection case (bad count, unknown option, unknown
  group, duplicate) lands in the same `ValidationError` with all of that
  request's problems collected into one `issues` array — matching
  `validateNewItem`'s "collect everything, throw once" contract exactly. No new
  error class introduced.
- **Adequate**: Uses `ValidationError` correctly but throws as soon as the first
  problem is found rather than aggregating, which silently regresses the
  multi-issue-report guarantee the rest of the codebase relies on.
- **Thin**: Introduces a second error-handling idiom — a boolean return, a
  custom exception type, or reusing `NotFoundError` for problems that are
  actually about a malformed request rather than a missing record.

## 3. Data modelling

- **Strong**: `ModifierGroup`/`ModifierOption`/`ModifierSelection` are used
  as-given without redundant reshaping, `minSelections`/`maxSelections` are the
  actual source of truth for bounds checking, and the function signature stays
  scoped to pricing one order line for one item (item + groups + selections in,
  total price out) rather than pulling in persistence or cross-item concerns.
- **Adequate**: Models the selection-counting correctly but conflates
  `rule` and `min`/`max` (e.g. asserts `rule === 'exactly_one'` somewhere as a
  shortcut instead of trusting the bounds), which happens to work for the
  fixture data but is fragile.
- **Thin**: Reworks `MenuItem` or the repository to store modifier groups
  directly, or adds a new repository/persistence layer for groups that the
  ticket never asked for.

## 4. Test quality

- **Strong**: Adds tests beyond what `feature.test.ts` already covers —
  e.g. a group with a negative price delta, a group where `maxSelections`
  exceeds the number of available options, or asserting the exact `issues`
  array contents for a specific invalid case — and every added test asserts on
  the return value or thrown error, never on internal call counts or private
  state.
- **Adequate**: Adds one or two tests that duplicate what's already in
  `feature.test.ts` in substance (different fixture, same assertion shape)
  without covering a genuinely new case.
- **Thin**: No tests added beyond the shipped suite, or added tests assert
  implementation details (e.g. spying on `Map`/`Set` usage, checking iteration
  order) rather than observable behavior.

## 5. Scope discipline

- **Strong**: The diff touches `src/modifier-pricing.ts` only (plus any tests
  the candidate added). `menu-service.ts`, `menu-repository.ts`, `types.ts`,
  `errors.ts`, and `validation.ts` are untouched, because nothing about pricing
  one order line requires changing them.
- **Adequate**: Makes one small, defensible touch outside the stub (e.g. a
  one-line export tweak) but doesn't restructure anything.
- **Thin**: Refactors unrelated parts of the existing service "while in
  there" — renaming methods, changing `MenuService`'s id-generation scheme,
  reformatting files that weren't part of the ticket — none of which
  `regression.test.ts` was written to specifically forbid by name, but which
  is exactly the kind of scope creep this ticket doesn't ask for and a real
  reviewer would push back on.

The specific traps candidates commonly fall into on this exercise are listed
in `solutions/feature/menu-modifiers.md` under "Common mistakes."
