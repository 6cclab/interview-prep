# Bug report: customer sees a feature they never bought

**Reported by:** Support (escalated from a billing dispute)
**Affected account:** Northwind Traders, customer id `cust_48213`
**Product area:** Premium Analytics gating

## Summary

Northwind Traders is on our free plan and has never purchased Premium
Analytics. Their admin opened a ticket saying the Premium Analytics
dashboard is fully accessible in their account — no paywall, no "upgrade to
unlock" prompt, full data. Billing confirms no Premium Analytics purchase
exists on this account, ever.

We pulled a handful of other customer ids while investigating and couldn't
reproduce it on any of the other free-plan accounts we tried. Northwind is a
newer account and support suspects something about how it was set up matters
here, but nobody has established what.

## Steps to reproduce

1. Load the feature gate for customer `cust_48213`, feature
   `premium-analytics`.
2. Observe that access is granted.
3. Compare against Northwind's billing record, which shows no purchase of
   this feature.

## Expected behaviour

A customer with no purchased entitlement for `premium-analytics` should be
denied access to it, full stop — migrated account or not.

## Running the tests

```bash
pnpm test entitlements-gate
```

Two files ship here:

- `repro.test.ts` reproduces the reported symptom above. It currently
  fails.
- `invariant.test.ts` exercises a related code path in this same module and
  currently fails too.

Both are checked into this exercise in a failing state — that's the
starting point, not something broken on your end. A change that only turns
`repro.test.ts` green has not found the actual problem; treat both files as
the bar you need to clear.

## Your task

Find the root cause and fix it. Don't special-case Northwind's account —
whatever's wrong here can happen to any customer under the right
conditions, and the fix should hold for all of them.
