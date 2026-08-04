# Solution: entitlements-gate

## Root cause

`src/resolveEntitlements.ts` is the shared helper both `featureGate.ts` and
`upsellBanner.ts` call to get a customer's entitlement list:

```ts
export async function resolveEntitlements(customerId: string): Promise<EntitlementRecord[]> {
  const response = await fetchEntitlements(customerId)
  return response.entitlements ?? []
}
```

`fetchEntitlements` returns `entitlements: null` for two very different
situations that both look the same from the caller's side: a customer who
genuinely has zero entitlements, and a customer whose entitlements
*couldn't be resolved at all* (no row yet — replication lag, an
in-flight migration, etc., as happened to Northwind Traders'
`cust_48213`). The `?? []` collapses both cases into the same empty array,
throwing away the one bit of information ("we don't actually know") that
the two consumers needed to handle this safely.

Each consumer then makes its own reasonable-looking assumption about what
an empty list means, and both assumptions are wrong for the unresolved
case:

- `featureGate.ts` treats an empty list as "nothing has been restricted for
  this account" and grants access (`entitlements.length === 0` →
  `return true`). For `cust_48213` this means an unentitled customer gets
  the paid feature — the reported symptom.
- `upsellBanner.ts` treats an empty list as "no active entitlement for this
  feature" and shows the upgrade banner (`!alreadyEntitled`). For a
  customer who *has* purchased the feature but whose entitlements
  happen to be unresolved at read time, this means they get pitched an
  upsell for something they already own.

Both bugs trace back to the same defect: the resolver must not silently
turn "unresolvable" into "resolved to nothing."

## The fix

Make `resolveEntitlements` preserve the distinction by signaling the
unresolved case distinctly (a thrown error works well here, since it can't
be accidentally treated as a truthy/falsy value the way a sentinel field
could), and make both consumers fail closed on it:

```ts
// resolveEntitlements.ts
export class EntitlementsUnresolvedError extends Error {
  constructor(customerId: string) {
    super(`entitlements could not be resolved for customer ${customerId}`)
    this.name = 'EntitlementsUnresolvedError'
  }
}

export async function resolveEntitlements(customerId: string): Promise<EntitlementRecord[]> {
  const response = await fetchEntitlements(customerId)
  if (response.entitlements === null) {
    throw new EntitlementsUnresolvedError(customerId)
  }
  return response.entitlements
}
```

```ts
// featureGate.ts
export async function canUseFeature(customerId: string, featureId: string): Promise<boolean> {
  try {
    const entitlements = await resolveEntitlements(customerId)
    return entitlements.some((e) => e.featureId === featureId && e.active)
  } catch (err) {
    if (err instanceof EntitlementsUnresolvedError) return false
    throw err
  }
}
```

```ts
// upsellBanner.ts
export async function shouldShowUpsell(customerId: string, featureId: string): Promise<boolean> {
  try {
    const entitlements = await resolveEntitlements(customerId)
    return !entitlements.some((e) => e.featureId === featureId && e.active)
  } catch (err) {
    if (err instanceof EntitlementsUnresolvedError) return false
    throw err
  }
}
```

With this, `entitlements.length === 0` in either consumer is now a real
signal ("resolved, and there are zero rows") instead of an overloaded one,
and both consumers fail closed — deny access, withhold the upsell — when
the service can't answer.

## Why the tempting local patch is wrong

The obvious quick fix, once you've reproduced the symptom, is to special-case
`featureGate.ts`:

```ts
if (entitlements.length === 0) {
  return false // was: return true
}
```

or even narrower, special-casing the one account:

```ts
if (customerId === 'cust_48213') return false
```

Either one makes `repro.test.ts` pass — Northwind Traders no longer sees
Premium Analytics. But `invariant.test.ts` exercises `upsellBanner.ts`,
which never touches `featureGate.ts` and still calls
`resolveEntitlements` directly. It still can't tell "resolved to nothing"
from "unresolved," so a paying customer whose entitlements are unresolved
still gets shown an upsell for a feature they already own. The patch fixed
one symptom of the defect while leaving a second, independent symptom of
the *same* defect in place — proof that it patched a call site instead of
the shared helper that both call sites depend on.
