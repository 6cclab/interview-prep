# Solution: Idempotent Payments

## Reading the existing conventions first

Before touching `idempotentCapture.ts`, `paymentService.ts` and friends establish a
pattern worth naming explicitly:

- **Errors** (`errors.ts`): a `Result<T, E>` discriminated union for every fallible
  call — no throwing for expected outcomes — plus a tagged `PaymentError` union
  keyed on a `type` field. `ok()`/`err()` helper constructors, not object literals
  built by hand at each call site.
- **Client boundary** (`gateway.ts`): `PaymentGatewayClient` is the only thing that
  knows a real processor exists. Nothing above it should reach past that interface.
- **Repository pattern** (`orderRepository.ts`, `paymentRepository.ts`): an
  interface plus an in-memory `Map`-backed implementation, async methods even
  though nothing awaits I/O yet.
- **Dependency injection**: `PaymentCaptureService` takes its id generator and
  clock as constructor deps, specifically so tests get deterministic output. New
  code that needs either should reuse the same instances, not reach for
  `Date.now()`/`crypto.randomUUID()` directly.

The idempotency wrapper needs to look like the fourth repository-shaped thing in
this file, not like a bolt-on cache.

## The key design decision: reserve before charging

The tempting shortcut is "call the inner service, then cache the response." That
passes a same-key-same-body-twice test that awaits sequentially, because by the
time the second call runs, the cache already has an entry. It fails the moment two
retries overlap — which is exactly the scenario idempotency keys exist for — because
neither call has written anything to the cache yet when the second one starts.

The fix is to reserve the key *before* awaiting the gateway, using the fact that
`Map.set` and the call into `inner.capture()` both happen synchronously before the
first `await` inside `capture()` yields control. Concretely: store the *promise*
returned by `inner.capture()`, not its eventual value, and store it immediately
after calling `inner.capture()` — before returning, before any `await`.

```ts
import type { PaymentError, Result } from './errors'
import { err } from './errors'
import type { PaymentCaptureService } from './paymentService'
import type { PaymentCaptureRequest, PaymentCaptureResult } from './types'

export type IdempotentCaptureError =
  | PaymentError
  | { readonly type: 'idempotency_key_conflict'; readonly idempotencyKey: string }

interface IdempotencyRecord {
  readonly fingerprint: string
  readonly promise: Promise<Result<PaymentCaptureResult, IdempotentCaptureError>>
}

// Stable serialization: pass the sorted key list as JSON.stringify's replacer so
// two requests with the same fields in different insertion order still fingerprint
// identically, instead of an unstable JSON.stringify(request) that would treat
// them as a conflict.
function fingerprint(request: PaymentCaptureRequest): string {
  return JSON.stringify(request, Object.keys(request).sort())
}

export class IdempotentPaymentCaptureService {
  private readonly records = new Map<string, IdempotencyRecord>()

  constructor(private readonly inner: PaymentCaptureService) {}

  async capture(
    request: PaymentCaptureRequest,
    idempotencyKey: string,
  ): Promise<Result<PaymentCaptureResult, IdempotentCaptureError>> {
    const requestFingerprint = fingerprint(request)
    const existing = this.records.get(idempotencyKey)

    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        return err({ type: 'idempotency_key_conflict', idempotencyKey })
      }
      return existing.promise
    }

    const promise = this.inner.capture(request)
    this.records.set(idempotencyKey, { fingerprint: requestFingerprint, promise })
    return promise
  }
}
```

### Why this satisfies each rule

- **Same key, same body**: the second call finds `existing`, fingerprints match, and
  it returns `existing.promise` — the exact same promise the first call is already
  waiting on, not a new call into `inner`.
- **Same key, different body**: fingerprints differ, so it's `err(...)` with no call
  into `inner` at all — no risk of a second charge even on a bad retry.
- **No double charge on overlapping retries**: `this.records.set(...)` runs
  synchronously, before `capture()`'s first `await`. Because JavaScript never
  preempts a synchronous stretch of code, a second `capture()` call for the same
  key — no matter how soon after the first — always sees the record already there.
  There's no window where two concurrent calls both observe "no record yet."
  Declined attempts are cached the same way as successes: `inner.capture()`'s
  `Result` (success or `gateway_declined`) is what gets stored and replayed, so a
  retry of a declined attempt doesn't try the gateway again either.

### Naive version that fails the interesting test

```ts
async capture(request, idempotencyKey) {
  const requestFingerprint = fingerprint(request)
  const existing = this.records.get(idempotencyKey)
  if (existing) {
    if (existing.fingerprint !== requestFingerprint) {
      return err({ type: 'idempotency_key_conflict', idempotencyKey })
    }
    // falls through and calls inner.capture() again anyway
  }
  const result = await this.inner.capture(request)
  this.records.set(idempotencyKey, { fingerprint: requestFingerprint, result })
  return existing ? existing.result : result
}
```

This returns the right *value* on a sequential same-key-same-body retry (the cached
`existing.result`), so a test that only checks the response would pass it. But it
still calls `inner.capture()` — and therefore the gateway — on every retry, so a real
customer gets charged twice. `feature.test.ts` catches this because it asserts
`gateway.callCount`, not just the response shape: two same-key-same-body calls
produce `gateway.callCount === 1` in the real solution and `2` in this one.

## Common mistakes

- **Keying only on `idempotencyKey`**, with no fingerprint at all — makes rule 2
  (conflict on a different body) impossible to implement, so it gets skipped.
- **Caching after the charge instead of reserving before it** — passes a
  sequential-retry test, fails a concurrent one (see above).
- **Unstable body comparison** — `JSON.stringify(request) === JSON.stringify(other)`
  without controlling key order looks right until two logically identical requests
  get built with fields in different order and wrongly register as a conflict.
- **Adding an `idempotencyKey` field to `PaymentCaptureRequest` and threading it
  through `PaymentCaptureService`** instead of composing a wrapper around it — works,
  but abandons the service/wrapper seam the stub was pointing at and touches a file
  the ticket didn't ask you to change.
