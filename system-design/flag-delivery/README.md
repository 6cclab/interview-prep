# Design: Feature-Flag Delivery for an Engineering Org

Design the system that delivers feature-flag values to application services across
an engineering organisation. The org uses a third-party SaaS flag vendor as the
source of truth for flag definitions and targeting rules, but that vendor has had
outages, and during the last one, every service that evaluates flags either served
stale data or failed to evaluate flags at all — some services fell back to hardcoded
defaults, some blocked on the vendor and timed out, and nobody had decided in
advance which behavior was correct for which flag.

Your job is to design the delivery path between the vendor and the application code
that calls `isEnabled(flagKey, user)`, such that flag evaluation keeps working,
correctly, when the vendor is unreachable.

## Requirements

- Application services (a mix of long-running server processes and short-lived
  client-side sessions) call an SDK to evaluate flags in the hot path of a request.
  Evaluation must be fast — this cannot add meaningful latency to every request.
- Flag definitions and targeting rules are authored and stored in the vendor's SaaS
  product. Your system does not own that authoring UI or the rule engine's source
  of truth; it owns how those rules and values reach evaluating code reliably.
- The org has dozens of services, split between backend services that hold
  long-lived processes and browser or mobile clients that evaluate flags locally.
  These two populations need different delivery characteristics.
- When the vendor is unreachable, every flag evaluation must still return
  *something* — the system must define what "correct" means in that case, and that
  answer needs to be defensible to the people who'll ask why a flag did what it did
  during an outage.
- The system must survive a fresh deploy or a cold process start without a working
  connection to the vendor yet established.
- The org operates in more than one region.

## Scale to design for

- On the order of 50 services depend on this path, split roughly 3:1 between
  server-side and client-side consumers.
- Flag evaluation happens on a large fraction of requests — this is a hot-path
  dependency, not a background job.
- The org wants sub-millisecond evaluation latency from the perspective of the
  calling application code.

## What the interviewer wants covered

- How flag values get from the vendor to the code calling `isEnabled()` — what sits
  in between, and why.
- What "correct" means when the vendor is unreachable: is the last known value
  served, is there a per-flag default, does evaluation fail closed, and who decides
  which behavior applies to which flag.
- How a service or client behaves on cold start, before it has ever successfully
  reached the vendor or any intermediate layer.
- The tradeoff of introducing anything between the vendor and the application —
  what does that component solve, and what new failure mode does it introduce.
  If you put something in the middle of this path, be ready to defend it against
  the challenge that you've just built a second single point of failure to protect
  against the first one.
- How this behaves across regions.
- The difference in delivery approach for server-side long-running processes versus
  client-side sessions, and why they can't use the same design.

## Out of scope (say so, don't design it)

- The flag-authoring UI, targeting-rule syntax, or experimentation/analytics layer
  built on top of flag evaluation — that's the vendor's product, not yours.
- Build vs. buy — assume the org has already decided to use a SaaS vendor for flag
  management and is not migrating off it.
