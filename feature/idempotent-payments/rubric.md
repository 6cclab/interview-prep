# Rubric: Idempotent Payment Capture

Score each dimension strong / adequate / thin / absent. One sentence of evidence per
rating, quoting or pointing at the attempt's own code. Tests passing is necessary but
not sufficient — this rubric covers what `pnpm test` can't see.

## 1. Convention match

- **Strong**: The new code is unrecognizable as "the AI wrote this part." Errors are
  a tagged union appended to `PaymentError`'s style (a `type` field, no exceptions
  for expected outcomes), success/failure is a `Result<T, E>`, async methods return
  `Promise` even where nothing awaits, and any new storage follows the existing
  repository shape (an interface plus an in-memory `Map`-backed implementation)
  rather than being a bag of module-level state or an ad hoc class field.
- **Adequate**: Gets the `Result`/tagged-error shape right but the storage doesn't
  look like it was written by the same person as `orderRepository.ts` /
  `paymentRepository.ts` — e.g. a class with a public mutable map and no interface.
- **Thin**: Half the new code returns `Result`s and half throws, or the storage is a
  raw `Map` reached into directly from the service instead of behind any boundary.
- **Absent**: New code reads like it was dropped in from a different codebase —
  callbacks, exceptions for expected outcomes, or a totally different naming style.

## 2. Error handling

- **Strong**: The conflict case returns `Result`'s `err(...)` with a tagged error,
  exactly like every other validation failure in `paymentService.ts` — no new
  control-flow mechanism introduced for this one case.
- **Adequate**: Returns the right shape for the conflict but reaches for `throw` in
  some other new branch (e.g. throws if the order lookup inside the wrapper fails,
  when the inner service already reports that as a `Result`).
- **Thin**: Conflict is signaled by returning `undefined`, `null`, or a boolean
  instead of a tagged error the caller can pattern-match on.
- **Absent**: Conflict throws an exception that the existing code never throws for
  an expected, client-triggerable condition.

## 3. Data modelling

- **Strong**: The idempotency record stores enough to detect a body mismatch — some
  representation of the request (a fingerprint/hash or the request itself), not
  just the key — plus enough to replay the original outcome without recomputing
  it (the stored `Result`, or an in-flight promise for it). Reasons, even briefly,
  about what's stored while a request is still being processed versus after it
  completes.
- **Adequate**: Stores a body fingerprint and the final result, but nothing for the
  in-flight case — a second call while the first is still running has no way to
  find "there's already one of these running."
- **Thin**: Stores only the final response, with no way to compare bodies on a
  later call — any body reuses the cached response.
- **Absent**: Stores only `key → true` or similar, with no request or result data
  at all.

## 4. Correctness of the conflict rule

- **Strong**: Picks a specific, justified notion of body equality (e.g. a stable
  JSON serialization of the fields that matter, or field-by-field comparison) and
  states *why* — e.g. object key order in a naive `JSON.stringify` of the raw
  request would make two logically-identical requests compare unequal, so the
  comparison needs to be order-independent or restricted to a known field list.
- **Adequate**: Uses a reasonable equality check (e.g. compares a fixed list of
  fields) but doesn't explain the choice or consider the ordering pitfall.
- **Thin**: Uses reference equality (`===`) or a shallow check that only happens to
  work because the test fixtures reuse the same object.
- **Absent**: No body comparison at all — any request with a matching key is
  treated as the same request, silently violating rule 2.

## 5. Test quality

- **Strong**: Adds tests beyond the shipped `feature.test.ts` that assert *behavior*
  — e.g. that a third, unrelated idempotency key is unaffected, or that a
  differently-ordered-but-equal request body is *not* treated as a conflict — not
  implementation details like "the map has one entry." Tests read as specs, not as
  a mirror of the implementation.
- **Adequate**: Adds one or two tests, but they largely restate what
  `feature.test.ts` already covers rather than adding new cases.
- **Thin**: Adds a test that asserts on internal state (e.g. reaches into a private
  field, or checks `console.log` output) instead of observable behavior.
- **Absent**: No new tests written.

## 6. Scope discipline

- **Strong**: Touches only what the ticket requires — the stub file, plus whatever
  new internal storage the feature needs. `paymentService.ts`,
  `orderRepository.ts`, `paymentRepository.ts`, and `gateway.ts` are unchanged.
- **Adequate**: Makes one small, justifiable touch outside the stub (e.g. exporting
  a type from `errors.ts` that was already private) with a clear reason.
- **Thin**: Refactors an existing file's structure (e.g. renames methods, changes
  `PaymentCaptureService`'s constructor shape) to make the new code fit more
  comfortably, beyond what idempotency actually requires.
- **Absent**: Rewrites large parts of the existing service "while in there,"
  changing behavior the regression suite doesn't happen to cover.

The specific traps candidates commonly fall into on this exercise are listed
in `solutions/feature/idempotent-payments.md` under "Common mistakes."
