# Solution: stale-cache

## Root cause

`cacheKeyForResource` in `debugging/stale-cache/src/cache.ts` builds the
cache key from `resourceId` alone:

```ts
export function cacheKeyForResource(resourceId: string): string {
  return `resource:${resourceId}`
}
```

Both `dashboardWidget.ts` and `profilePanel.ts` call `cache.getOrLoad(cacheKeyForResource(resourceId), ...)`
to populate the cache with data scoped to `session.accountId`, but the key
never includes `accountId`. The cached *value* depends on the account, but
the cache *key* doesn't — so once an entry for `resource:res-1` is written
while the session is on Alpha Corp, every later read of `resource:res-1`
returns Alpha Corp's data, no matter which account the session has since
switched to. Nothing in `Session.switchAccount` invalidates the cache
either, so there's no second line of defense.

This is a single defect with two independent symptoms: any consumer of the
cache, reached via any account-changing transition, can serve another
account's data.

## Why the two tests both matter

- `repro.test.ts` drives the exact scenario from the bug report: switch
  accounts through the dashboard's own switcher, then re-render the
  dashboard widget.
- `invariant.test.ts` drives a different consumer (`profilePanel.ts`) and a
  different switch entry point (`session.switchAccount` called directly, as
  the global nav switcher would call it) — same defect, different path.

A fix that only touches the path exercised by `repro.test.ts` — e.g. adding
`cache.clear()` inside `switchAccountAndRefreshDashboard` — makes `repro`
pass because that's the exact call path the test drives, but leaves
`invariant` red, because `profilePanel.ts` and the direct
`session.switchAccount` path never go through that function. That's the
tell that the fix targeted the report, not the defect.

## The fix

Give the cache key the dimension the value actually varies on:

```ts
export function cacheKeyForResource(accountId: string, resourceId: string): string {
  return `resource:${accountId}:${resourceId}`
}
```

And update both call sites to pass `session.accountId`:

```ts
// dashboardWidget.ts and profilePanel.ts
const record = await cache.getOrLoad(
  cacheKeyForResource(session.accountId, resourceId),
  () => dataClient.fetchResource(session.accountId, resourceId),
)
```

With the account folded into the key, switching accounts naturally lands on
a different cache entry (or a miss that triggers a fresh load) — no matter
which screen or which switch entry point triggered it. No explicit
invalidation call is needed, which is also why the fix doesn't care whether
the "handler" that changed the account happened to remember to clear
anything.

## Tempting patches that don't work, and why the suite catches them

- **Clear the cache in the reported handler** (`switchAccountAndRefreshDashboard`):
  fixes `repro` (same call path) but leaves `invariant` red, since
  `profilePanel.ts`'s render path and the direct `session.switchAccount`
  call never run that function. Verified: `repro` passes, `invariant`
  still fails with the same assertion.
- **Shorten the TTL**: does nothing, because the defect isn't about staleness
  over time — it's about the key never distinguishing accounts in the first
  place. The tests use an injected fixed clock that never advances, so a
  shorter (but still positive) TTL has no effect either way. Verified with
  `ttlMs` dropped from `300_000` to `1`: both tests still fail with the same
  assertion errors as the unmodified suite.

## Determinism

`ResourceCache` takes an injected `Clock` (`{ now(): number }`) instead of
calling `Date.now()` directly. `systemClock` (real time) is exported for
production use, but both test files construct the cache with a fixed clock
(`{ now: () => FIXED_TIME }`) that never advances during the test. This
means TTL expiry is fully under the test's control and can't introduce
flakiness or accidentally mask the bug via a race with wall-clock time.

## Verification log

- Shipped (broken) state: `repro.test.ts` and `invariant.test.ts` both fail
  — `repro` on the dashboard-widget assertion, `invariant` on the
  profile-panel assertion. Ran twice; identical failures both times.
- Symptom patch (`cache.clear()` inside `switchAccountAndRefreshDashboard`,
  wired through `repro.test.ts`'s call site only): `repro` passes,
  `invariant` still fails on the same assertion.
- TTL reduced from `300_000` to `1` (clock still fixed, never advanced):
  both tests still fail, same assertions as the shipped state.
- Root-cause fix (account folded into the cache key in both consumers):
  `pnpm typecheck` silent, both tests pass.
- Reverted to shipped state to confirm both tests fail again before commit.
