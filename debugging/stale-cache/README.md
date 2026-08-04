# Bug Report: Wrong account's data shown right after switching accounts

**Reported by:** Internal user (Ops team)
**Severity:** High — looks like a cross-account data exposure
**Environment:** Staging, this morning's build

## Summary

I manage two of our client accounts, "Alpha Corp" and "Beta Retail." I was
looking at Alpha Corp's quarterly report on the dashboard, then used the
account switcher to move my session over to Beta Retail. When the dashboard
came back, it was still showing **Alpha Corp's numbers, labeled as if they
belonged to Beta Retail**. I hadn't reloaded the page or done anything else
unusual — just switched accounts and looked at the same widget again.

A hard refresh made it show the correct Beta Retail data. But the fact that
it was wrong for even a moment, and that it wasn't obviously wrong (the
numbers just looked like real Beta Retail numbers), is what worries me. If
I hadn't happened to remember Alpha Corp's figures, I wouldn't have noticed.

## Steps to reproduce

1. Log in and set the active account to "Alpha Corp."
2. Open the dashboard and view the quarterly report widget.
3. Confirm it shows Alpha Corp's figures.
4. Switch the active account to "Beta Retail" using the account switcher.
5. Without doing a full page reload, view the report widget again.

## Observed

The widget displays Alpha Corp's data, mislabeled under Beta Retail.

## Expected

Once the account switch completes, everything in the app should reflect the
newly active account. Nothing should ever show data left over from an
account the session has already moved away from.

## What I've checked

- This reproduces consistently for me on the dashboard widget.
- I have not had time to check whether it shows up anywhere else in the
  app, or whether it's specific to switching accounts versus other things
  that change what I'm allowed to see. Flagging that as a gap in my
  testing, not as a "no."

## Running the tests

```
pnpm test stale-cache
```

Both `repro.test.ts` and `invariant.test.ts` are included and currently
**fail**. This is a debugging exercise — the failures are the starting
point, not something you introduced.

- `repro.test.ts` reproduces the exact scenario described above.
- `invariant.test.ts` exercises a different screen under the same kind of
  conditions. It is currently failing too, and that's on purpose: it's
  driven by the same underlying defect as the reported bug, not a separate
  issue.

**Before you call this fixed:** a change that makes `repro.test.ts` pass
while `invariant.test.ts` is still failing has patched the one screen from
the report, not the actual defect. Both tests should pass once the real
problem is fixed — neither is optional.
