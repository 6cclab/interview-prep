# Bug report: loyalty discount is inconsistent

**Status:** Escalated to engineering after three months in support queue.
**Component:** Checkout / promotions.

## Summary

Customers who qualify for our loyalty discount (15% off, triggered once an
order subtotal crosses $100) sometimes get it and sometimes don't. Support
has closed and reopened this ticket four times because every time we ask the
customer to reproduce it, the answer is "it just started working" or "it
stopped again," with no pattern support can pin down.

## What we've observed

- Customer A placed a $120 order in March. No discount applied. Complained.
  Placed another $150 order in April — this time the discount was there.
  Nothing in the account changed between the two orders as far as support
  could tell.
- Customer B has never seen the discount, across six qualifying orders over
  four months.
- Customer C sees it every single time.
- Support's working theory was that it's account-specific — maybe a stale
  flag on certain customer records, maybe a segment/cohort issue. We asked
  Data to pull the affected customer IDs and look for anything they have in
  common (signup date, region, payment method, marketing opt-in). Nothing
  correlated.
- We also considered a caching issue (discount computed once and reused
  from a stale cache) and asked infra to check — no caching layer sits in
  front of this computation, so that was ruled out.
- Re-running the same order for an affected customer (support's usual fix —
  cancel and rebook) works about half the time, which fed the "account is
  just flaky" theory, but nobody could explain the other half.

## What we know for sure

- The discount rule itself is correct: any order with a subtotal at or above
  $100 should get 15% off, permanently applied to that customer going
  forward (so their next order should also reflect it).
- It is **not** random — running the same test scenario twice in this repo
  gives the same result both times. Whatever is going on is deterministic
  given the same inputs; we just haven't found what input actually matters.
- It's not about the customer. It's not about timing. It's not about
  caching.

## Reproduction

```
pnpm test partial-write
```

This runs two files:

- `repro.test.ts` — a minimal reproduction of the reported symptom. It ships
  **failing**. If your fix makes this pass, you've addressed the symptom,
  but that alone does not mean you've found the actual defect.
- `invariant.test.ts` — a broader check that also ships **failing** and is
  directly related to this bug. It doesn't target the same code path as
  `repro.test.ts`. A fix that turns `repro.test.ts` green while
  `invariant.test.ts` stays red has not found the real problem — it's
  patched one symptom while leaving the underlying defect (and the
  customers who hit it through a different path) exactly where it was.

Both files need to pass for this to be considered fixed.

## Your task

Find the actual defect and fix it at the root. Do not special-case any of
the customer IDs used in the tests, and don't add retry logic — none of
that addresses why this happens in the first place.
