# Rubric: Feature-Flag Delivery for an Engineering Org

Score each dimension **strong / adequate / thin / absent**. One sentence of
evidence per rating, quoting the attempt's own words. No score without a quote.

## 1. Requirements clarification

- **Strong** — Distinguishes server-side evaluation (long-lived process, can hold
  an in-memory rule set) from client-side evaluation (short-lived session, can't be
  trusted with the full targeting-rule payload) as different problems before
  designing a shared answer. Asks what "unavailable" means: total vendor outage,
  network partition between org and vendor, or degraded/slow responses — these
  demand different designs.
- **Adequate** — Notes there are two consumer types but doesn't let it change the
  design; treats "vendor is down" as one failure mode without probing which kind.
- **Thin** — Goes straight to picking a caching layer without asking who's
  consuming the flags or what correctness means for them.
- **Common miss:** treating this as "add a cache in front of an API" without
  clarifying that client-side SDKs can't be handed the same trust boundary as
  server-side ones — a browser can be made to dump its full rule payload.

## 2. Back-of-envelope estimation

- **Strong** — Puts a number on evaluation volume (requests/sec × flags checked per
  request, or sessions × flags on page load) and on payload size (targeting rules
  for N flags × M services), and uses those numbers to justify a design choice —
  e.g., why an in-memory cache is feasible at this rule-set size, or why streaming
  beats polling at this update frequency.
- **Adequate** — States that evaluation must be "fast" or "high volume" without a
  number, or gives a number that never feeds back into a decision.
- **Thin** — No numbers anywhere; latency and scale are asserted, not derived.
- **Common miss:** never estimating how large the full flag-and-rules payload gets
  across dozens of services — this number is what determines whether "hold
  everything in memory" is even plausible.

## 3. API surface

- **Strong** — Defines the SDK-facing contract (`isEnabled(key, context)` and
  equivalent) as unchanged from the app's point of view, and separately defines the
  protocol between SDK and whatever sits between it and the vendor — explicitly
  compares streaming (persistent connection, server pushes changes) against
  polling (periodic pull), and picks one with a reason tied to update latency and
  connection overhead at this service count.
- **Adequate** — Mentions there's an SDK and a delivery layer but describes the
  protocol between them vaguely ("it syncs periodically") without comparing
  alternatives.
- **Thin** — Only discusses the app-facing `isEnabled()` call; the delivery
  protocol between components is unaddressed.
- **Common miss:** conflating the app-to-SDK contract with the SDK-to-backend
  protocol — they're different APIs with different constraints and are often
  discussed as if they're the same call.

## 4. Data model

- **Strong** — Specifies what's cached, where, and its shape: flag key, targeting
  rules (or pre-evaluated per-user results, if the design pushes evaluation
  upstream), a version or timestamp for staleness detection, and a last-known-good
  marker distinct from "value has never been fetched." Explains what's held
  server-side (can hold full rule sets) versus what's sent to clients (should be
  reduced — evaluated results or a scoped rule subset, not everything).
- **Adequate** — Describes a cache holding flag values but doesn't distinguish
  storing raw targeting rules from storing pre-evaluated results, or doesn't handle
  staleness/versioning.
- **Thin** — "We cache the flags" with no shape, no versioning, no staleness
  concept.
- **Common miss:** not separating "definition changed" (a rule was edited) from
  "evaluation changed" (a targeting rule fired differently for this user) — these
  need different invalidation strategies.

## 5. Scale path

- **Strong** — Addresses multi-region explicitly: where the caching/delivery layer
  lives relative to each region, whether it's one global instance or one per
  region, and what happens to consistency of flag values seen by users in
  different regions during propagation. Addresses what happens as service count
  grows past the given scale — does the delivery layer's connection count or
  memory footprint become the new bottleneck.
- **Adequate** — Says "deploy one per region" without discussing the consistency
  gap that creates, or discusses scale-up without touching regions at all.
- **Thin** — Single-region design presented as complete; multi-region requirement
  from the prompt goes unaddressed.
- **Common miss:** assuming a single global cache instance is fine, then never
  reconciling that with the multi-region requirement stated up front.

## 6. Failure modes

- **Strong** — States explicitly what "correct" means when the vendor is down —
  last-known-good vs. a per-flag configured default vs. fail-closed — and says who
  decides which applies to which flag, not just which the system defaults to.
  Separately and explicitly addresses the counter-question: if something sits
  between vendor and app, what happens when *that* thing dies — is it a new single
  point of failure, and what's the fallback behind the fallback. Covers cold
  start: a process that has never successfully synced.
- **Adequate** — Says "fall back to last known value" but doesn't address what
  happens on cold start (no last-known value exists yet), or doesn't address the
  failure of the new intermediate component.
- **Thin** — Says vendor downtime is "handled by caching" without defining what
  the cache serves when it's also stale or empty.
- **Common miss:** designing a robust cache/proxy layer for vendor outages and
  never asking what happens when that layer itself goes down — the exact
  counter-question an interviewer is trained to ask.

## 7. Tradeoffs

- **Strong** — Names at least one real alternative not chosen (e.g., no
  intermediate layer at all, client SDKs talking directly to vendor with local
  caching only; or a polling-only design instead of streaming) and gives a
  specific reason it was rejected for this scale/latency profile, not a generic
  "it doesn't scale." Discusses the freshness-vs-availability tradeoff explicitly:
  serving a stale-but-known value during an outage means some users get flag
  behavior that's minutes or hours out of date — is that acceptable, and does it
  vary by flag.
- **Adequate** — Names an alternative without a specific rejection reason tied to
  this system's numbers or constraints.
- **Thin** — Presents one design with no alternatives considered.
- **Common miss:** not naming the staleness cost out loud — a design can be
  "resilient" and still be silently wrong for every user during the entire outage
  window if nobody says what "stale" costs.

## 8. Lived detail

This is a system the candidate actually built after a real outage. A
technically-correct but generic answer is a **weak** answer here — the interviewer
is checking whether he actually shipped this, not whether he can reason about it
from first principles.

- **Strong** — Names the incident that motivated the system (a SaaS vendor outage
  that took flag evaluation down org-wide) and describes the actual number of
  services or repos it had to cover, distinguishing server-side from client-side
  counts. Describes a specific contested decision — e.g., a tradeoff argued over
  with SRE or another team — and how it was resolved, not just that a review
  happened. Names the concrete infrastructure choice made (what ran the
  intermediate layer, what stored persistent cache state, what handled service
  auth between components, what surfaced its health) and why that specific choice
  over the obvious alternative.
- **Adequate** — References "an outage" and "a proxy we built" in general terms
  without a specific number, a specific contested decision, or a specific piece of
  infrastructure named.
- **Thin** — The design is technically sound but reads identically to how it would
  if the candidate had never built this — no incident, no number, no artifact of
  having presented this to anyone, no scar tissue.
- **Absent** — No lived detail offered at all; scores purely on architectural
  reasoning.
- **Common miss:** stopping at "we'd want a resilient caching layer" instead of
  saying what was actually deployed, what it actually persisted flag state in, how
  many repos it actually had to touch, and what question a director or SRE lead
  actually pushed back on before signing off.
