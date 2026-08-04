# Reference Design: Rate Limiter for a Public API

Spoiler. Read `rubric.md` and attempt the design in `local/designs/rate-limiter.md`
before opening this.

## 1. Requirements

**Functional**

- Enforce a per-client quota (requests per time unit, tiered: 10/min free up to
  50k/min enterprise), keyed on API key.
- Enforce a global quota protecting the backend regardless of how well-behaved
  individual clients are.
- On exceeding either limit, reject with a response that tells the client what
  happened and when to retry.
- Give every client visibility into their current usage against their limit via
  response headers, even on successful requests.

**Non-functional**

- Consistent enforcement across ~dozens of stateless API instances behind a load
  balancer — a client can't get extra quota by getting lucky with routing.
- Low added latency: budget ~1-2ms p99 for the rate-limit check itself, since it
  runs on every request.
- The limiter must not be a harder single point of failure than the system it's
  protecting — availability of the API should degrade gracefully, not hard-fail,
  if the limiter's own state store has a bad moment.

**Non-goals**

- AuthN/authZ (client identity is resolved upstream).
- Billing/metering analytics — this is enforcement, not usage reporting for
  invoices (that's a separate, eventually-consistent pipeline that can read the
  same events asynchronously).

## 2. Estimation

- 50k req/s sustained, bursts to 150k req/s.
- 200k active clients. Average rate per client: 50,000 / 200,000 = 0.25 req/s —
  most clients are nowhere near their limit most of the time. But the top tier is
  50,000 req/min = ~833 req/s *per client*. A handful of enterprise clients can
  individually approach a meaningful fraction of the platform's total sustained
  throughput, so the per-client path has to handle high-frequency single-key
  contention, not just many-keys-low-frequency.
- State size: one counter per client per algorithm-window is tiny — a fixed-window
  counter is an integer plus a TTL, call it ~100 bytes fully loaded with
  client/window metadata. 200k clients x 100 bytes = 20MB. This comfortably fits
  in memory on a single node. **Memory is not the constraint.**
- Operation rate is the constraint: every one of the 50k-150k req/s needs a
  read-modify-write against shared state (increment a counter, check against
  limit). That's 50k-150k ops/s minimum against whatever stores the counters,
  before considering the global-limit check adds a second op per request
  (potentially 100k-300k ops/s total).
- Added latency budget: a single Redis round-trip from an API instance in the same
  region is typically 0.3-1ms. That fits inside a 1-2ms budget for one op, but
  doing the per-client check and the global check as two sequential round-trips
  would blow it — they need to be one round trip (a single Lua script or pipelined
  call), not two.

## 3. API surface

This isn't a CRUD API — it's a cross-cutting behavior applied to every request.
The "surface" is:

**Response contract on every request:**

```
X-RateLimit-Limit: 1000          # this client's limit for the current window
X-RateLimit-Remaining: 842
X-RateLimit-Reset: 1732200000    # unix time the window resets
```

**On rejection:**

```
HTTP 429 Too Many Requests
Retry-After: 12
X-RateLimit-Scope: client        # or "global" — tells the client which limit was hit
{
  "error": "rate_limit_exceeded",
  "scope": "client",
  "retry_after_seconds": 12
}
```

Distinguishing `scope: client` from `scope: global` matters: a client hitting
their *own* limit should back off and maybe upgrade tier; a client rejected
because the *global* limit tripped needs a different signal (this isn't about
them, retry shortly) and ideally different backoff guidance.

**Internal surface** — how an API server instance asks the limiter for a
decision:

```
ALLOW(client_id, cost=1) -> { allowed: bool, remaining: int, reset_at: timestamp, scope_if_denied: "client"|"global" }
```

Implemented as a single round-trip (Lua script in Redis, see Data Model) so the
per-client and global checks happen atomically in one network hop, not two.

**Decision on limiter unavailability** is part of this contract, not an
afterthought — see Failure Modes.

## 4. Data model

**Store: Redis**, single logical instance for v1, justified by the estimation:
20MB of counter state is trivial for memory, and Redis's single-threaded
event loop gives strict per-key atomicity for free — no distributed lock needed
for a read-modify-write on one counter. The real requirement driving this choice
is that **all API instances must see the same counter state**, which rules out
per-instance in-memory counters as the primary mechanism (though they reappear
as a fallback — see Scale Path and Failure Modes).

**Algorithm: sliding window counter** (see Tradeoffs for why, over the
alternatives).

**Key structure, per client:**

```
ratelimit:{client_id}:{current_minute_bucket}   -> integer count, TTL 120s
ratelimit:{client_id}:{previous_minute_bucket}  -> integer count (read-only once past)
```

The sliding window counter estimates the current rate as a weighted blend of the
current and previous fixed-window buckets, weighted by how far into the current
window we are:

```
estimated_count = previous_bucket_count * (1 - elapsed_fraction_of_current_window) + current_bucket_count
```

This needs only two integers per client (bounded memory, unlike sliding log),
and smooths out the fixed-window boundary-burst problem (see Tradeoffs) without
storing a full request log.

**Global limit** uses the same mechanism with a single well-known key
(`ratelimit:global:{minute_bucket}`) rather than per-client keys, incremented on
every request regardless of client.

**Atomicity**: the increment-then-compare for both per-client and global limits
happens inside a single Lua script executed server-side in Redis, so "check
current count, decide allow/deny, increment if allowed" is one atomic operation
from the API instance's point of view — no race between two instances both
reading "9 of 10 used" and both deciding to allow the 10th and 11th request.

**TTL**: each bucket key gets a TTL of ~2x the window size (120s for a 1-minute
window) so stale buckets clean themselves up without a separate sweep process,
and a bucket read after expiry is treated as zero.

## 5. Scale path

**First bottleneck: single Redis primary's op throughput**, not memory. A single
Redis node handles on the order of 100k-200k simple ops/sec; with the global
limit adding a second logical check per request, we're already near that ceiling
at the stated 150k req/s burst. This is the first thing to break, and it breaks
as a **latency cliff** (ops start queueing) well before it breaks as an outage.

- **At ~5-10x current load (250k-500k req/s)**: shard the per-client keyspace
  across a Redis Cluster, hashed by `client_id`. Per-client limiting parallelizes
  cleanly since each client's counter lives on exactly one shard. The global
  counter does *not* shard the same way — it's one logical value — so it becomes
  its own scaling problem.
- **Global limit at scale**: stop trying to enforce it with perfect precision.
  Split the global budget across N shards/regions (e.g. each of 10 Redis shards
  gets 1/10th of the global limit as its own local counter) and accept that the
  *effective* global limit is now approximate — a shard that's quiet can't lend
  its unused budget to a shard that's busy without a reconciliation mechanism.
  This trades strict accuracy for removing the single global hot key. A periodic
  (every few seconds) async reconciliation job can rebalance shard budgets based
  on recent usage if the imbalance matters in practice.
- **At 100x (5M req/s, hypothetical)**: shared-state round-trips on every request
  stop being viable at all, even sharded. Move to **local token buckets on each
  API instance**, refilled at a rate derived from `client_limit / number_of_
  instances`, with periodic (every few seconds) async reporting to a central
  store for observability and coarse rebalancing rather than per-request
  coordination. This is a real accuracy-for-availability tradeoff: a client could
  get up to N times their limit if their traffic happens to land unevenly across
  N instances between reconciliation intervals. At this scale that's the correct
  trade — perfect enforcement of a per-minute quota was never the actual goal,
  protecting the backend and being roughly fair was.

**What doesn't help**: Redis read replicas. Rate limiting is a write on every
request (the increment), not a read-heavy workload, so replicas don't relieve the
bottleneck — they only help if the design mistakenly tries to do a separate read
before the write, which the atomic Lua-script approach avoids.

## 6. Failure modes

**Redis primary is unreachable or p99 latency spikes past budget:**

- **Per-client limit: fail open.** If the limiter can't get an answer in time,
  let the request through rather than reject it. Reasoning: a false 429 actively
  breaks a well-behaved client's application; a short window of unenforced
  per-client limits during an incident is a smaller cost than that, and it's
  self-correcting once Redis recovers. Log/metric every fail-open decision so
  it's visible, and treat a fail-open rate above a threshold as itself an
  alertable incident.
- **Global limit: fail toward a conservative local fallback, not fully open.**
  The global limit exists specifically to protect the backend from aggregate
  load; failing it open during the exact incident (Redis struggling) that's most
  likely correlated with backend stress is the wrong direction. Fall back to a
  static, conservative per-instance local rate limit (e.g. each of 50 API
  instances allows at most 1/50th of the global budget locally, enforced
  in-process with no round-trip) until the shared store recovers. This is less
  accurate than the real global counter but bounds the worst case instead of
  removing the protection exactly when it's needed most.

**Partial partition** — some API instances can reach Redis, others can't (network
segmentation, not a full Redis outage):

- Enforcement becomes inconsistent: a client routed to a partitioned instance
  gets fail-open/local-fallback behavior while others get precise enforcement.
  This is an accepted, bounded inconsistency rather than a design flaw to
  eliminate — the alternative (blocking all traffic on all instances until
  partition heals) is worse. Health-checking Redis reachability per-instance and
  routing around consistently-partitioned instances at the load balancer level
  limits how long this state persists for any one client.

**Clock skew across API instances / Redis clients:**

- Fixed-window algorithms are directly vulnerable to clock skew at the bucket
  boundary. The sliding-window-counter approach reduces but doesn't eliminate
  this — the `elapsed_fraction_of_current_window` calculation depends on a
  roughly-consistent clock. NTP-synced instances (standard in any real fleet)
  keep skew to milliseconds, well below the granularity that matters for
  minute-scale windows, so this is noted and accepted rather than solved further.

**A client is falsely rejected during a Redis blip that got fail-closed
somewhere (e.g. a bug, or the global-limit fallback triggering):**

- The 429 response's `scope` field and error body distinguish "you're over your
  own limit" from "the platform is protecting itself" so the client's retry
  behavior can differ, and so this is debuggable from a support ticket without
  guessing.

## 7. Tradeoffs (algorithm comparison)

| Algorithm | Accuracy | Memory per client | Compute per request | Verdict here |
|---|---|---|---|---|
| Fixed window | Allows up to 2x the limit across a window boundary (e.g. limit 100/min, client sends 100 in the last second of minute 1 and 100 in the first second of minute 2 — 200 requests in ~2 seconds, both windows individually compliant) | O(1): one counter | O(1): one incr | Rejected: the boundary-burst flaw is a real correctness gap for a security/protection control, not just an approximation error |
| Sliding log | Exact: stores every request timestamp, counts how many fall in the trailing window | O(requests in window) — for the 833 req/s enterprise client, that's tens of thousands of timestamps live at once | O(log n) to trim + count (sorted set) | Rejected: memory scales with request *rate*, not client count, which is exactly backwards for a system whose whole job is handling high-rate clients cheaply |
| Sliding window counter | Approximate, but bounds the boundary-burst problem to a small, provable error margin instead of 2x | O(1): two counters | O(1): read two counters, one weighted calc, one incr | **Chosen**: fixed memory regardless of request rate, closes the fixed-window boundary flaw well enough for enforcement purposes, cheap enough to run atomically in a single Lua script |
| Token bucket | Exact enforcement of a rate *with a configurable burst allowance* — bucket refills continuously, requests consume tokens, bucket has a max size that permits bursting above the steady rate up to that cap | O(1): token count + last-refill timestamp | O(1) | Considered and rejected as the *primary* mechanism only because the requirement here is a hard periodic quota ("100/min"), not a rate-with-burst-allowance; it becomes the right choice for the local-fallback and 100x-scale designs in the Scale Path section, where controlled bursting per instance is actually desirable |

The fixed-window-vs-sliding-window-counter comparison is the one to be most
precise about: the failure mode isn't "less accurate," it's a specific,
demonstrable 2x-over-limit scenario at the boundary, and being able to construct
that example is what separates a real understanding of the tradeoff from a
memorized ranking.

## What candidates typically get wrong here

- **Treating per-client and global limits as the same problem solved by the same
  mechanism**, missing that the global counter is a single hot key that doesn't
  shard the way per-client keys do, and needs its own scale story.
- **Choosing sliding log by default** because it's "the accurate one," without
  noticing its memory cost scales with request rate — exactly the dimension this
  problem is stress-testing (a small number of very high-rate clients).
- **Doing the per-client check and the global check as two separate Redis
  round-trips**, quietly doubling the latency budget and reintroducing a race
  window between the two checks.
- **Picking fail-open or fail-closed once, uniformly**, instead of recognizing the
  per-client and global limits have different failure priorities (client fairness
  vs backend protection).
- **Never mentioning clock skew or the window-boundary burst problem explicitly**
  — reciting algorithm names without being able to construct the concrete failure
  scenario each one has.
- **Conflating this system with the billing/metering pipeline** — trying to make
  the rate limiter also the source of truth for usage-based invoicing, which pulls
  in durability and audit requirements this system doesn't need and shouldn't take
  on in the hot path.
