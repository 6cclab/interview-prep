# Ticket: Make payment capture idempotent

## Background

`PaymentCaptureService.capture()` validates a capture request against the
order on file, charges the payment gateway, and records the result. It's a
small, working service — read it before you touch anything.

The problem: a POS terminal or a mobile client can lose its connection
after sending a capture request but before receiving the response. When
that happens the client's only reasonable move is to retry the exact same
request. Today, a retry is indistinguishable from a second, independent
purchase — it charges the card again.

## The feature

Callers may now attach an `Idempotency-Key` to a capture request (think of
it as an HTTP header the client generates once per logical attempt and
resends on every retry of that same attempt). The rules:

1. **Same key, same request body → the original result.** No new gateway
   charge. The caller gets back exactly what the first attempt produced —
   same payment, same gateway charge id, whether that attempt succeeded or
   was declined.
2. **Same key, different request body → rejected as a conflict.** Reusing a
   key for a different purchase is a client bug, not a retry, and must not
   be allowed to silently charge (or silently return the wrong receipt).
3. **No double charge, ever — including when retries overlap in time.** A
   client that retries aggressively (e.g. a fast timeout-and-retry loop) may
   fire a second request before the first one has finished talking to the
   gateway. Both requests are for the same key and the same body. The
   gateway must still be charged exactly once. This is not an edge case to
   handle "if there's time" — it's the actual failure mode idempotency keys
   exist to prevent, and it will be exercised directly: a test starts a
   second capture for the same key *before awaiting* the first one, so two
   overlapping captures for the same key must still result in exactly one
   charge.

### What counts as "the same request body"

Same order, same amount, same currency, same card token — i.e. the caller
is asking for the identical charge. A key reused with any field different
is a conflict per rule 2.

### Example

```
capture({ orderId: "order-1", amountCents: 4500, currency: "usd", cardToken: "tok_visa" }, idempotencyKey: "retry-abc")
→ { ok: true, value: { paymentId: "pay_1", gatewayChargeId: "ch_1", ... } }

# same key, same body — retried after a dropped connection
capture({ orderId: "order-1", amountCents: 4500, currency: "usd", cardToken: "tok_visa" }, idempotencyKey: "retry-abc")
→ { ok: true, value: { paymentId: "pay_1", gatewayChargeId: "ch_1", ... } }   # identical, no new charge

# same key, different amount — a client bug, not a retry
capture({ orderId: "order-1", amountCents: 5000, currency: "usd", cardToken: "tok_visa" }, idempotencyKey: "retry-abc")
→ { ok: false, error: { type: "idempotency_key_conflict", idempotencyKey: "retry-abc" } }
```

A retry of an attempt that was declined by the gateway should also replay
the original (declined) outcome rather than trying the charge again — the
gateway already gave a definitive answer for that key.

## Out of scope

- Persisting idempotency records across process restarts. In-memory for
  this exercise, same as the existing repositories.
- Expiring old idempotency keys. Don't build a TTL/cleanup mechanism.
- Idempotency for anything other than `capture` (refunds, voids, etc.).
- Changing the wire format of `PaymentCaptureRequest` or `PaymentError`.

## Where to work

The stub that needs implementing throws `not implemented`. Everything else
in `src/` is the existing, working service — match its conventions rather
than introducing a new style alongside it.

## Running it

```bash
pnpm test idempotent-payments
```

`regression.test.ts` covers the existing capture behaviour and ships
green — it must stay green. `feature.test.ts` covers the idempotency rules
above and ships red; making it green (without breaking the regression
suite) is the ticket.
