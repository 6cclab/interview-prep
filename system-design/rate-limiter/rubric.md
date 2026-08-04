# Rubric: Rate Limiter for a Public API

Score each dimension strong / adequate / thin / absent. One sentence of evidence per
rating, quoting the attempt's own words. No score without a quote.

## 1. Requirements clarification

- **Strong**: Separates per-client limiting from the global/system limit as two
  distinct mechanisms with different purposes (fairness vs self-protection), and
  states an explicit non-goal — e.g. "not designing the billing/metering path, only
  enforcement." Asks or states whether limits are per-API-key, per-user, or
  per-IP, and picks one deliberately rather than by default.
- **Adequate**: Distinguishes per-client and global limits but treats the choice of
  identity (API key vs IP) as an aside rather than a decision.
- **Thin**: Talks about "rate limiting the API" as one undifferentiated concern,
  never separating client-level fairness from platform self-protection.
- **Absent**: Jumps to an algorithm before establishing what is being limited or for
  whom.
- **Commonly missed**: that unauthenticated/pre-auth traffic (login attempts, failed
  API key lookups) needs its own limiting path since there's no client identity yet
  to key on.

## 2. Back-of-envelope estimation

- **Strong**: Derives concrete numbers from the prompt's 50k req/s and 200k clients
  — e.g. average per-client rate is ~0.25 req/s but the tail client at 50k req/min
  is ~833 req/s alone, meaning a handful of clients can approach the sustained
  platform total by themselves. Estimates the state size: 200k clients x a small
  fixed-size counter (~100 bytes with algorithm metadata) is ~20MB, comfortably
  in-memory on a single Redis node, and reasons about whether the *lookup rate*
  (up to 150k/s including bursts) rather than the data size is the real
  constraint.
- **Adequate**: States the 50k req/s and 200k clients numbers but doesn't do
  anything with them beyond restating the prompt.
- **Thin**: A number appears once, disconnected from any subsequent design choice
  (e.g. "we have a lot of requests" with no figure, or a figure that never affects
  the architecture).
- **Absent**: No numbers anywhere in the estimation or the design.
- **Commonly missed**: separating *data volume* (small — a few tens of MB of
  counters) from *operation rate* (large — every request is a read-modify-write),
  and concluding that the bottleneck is ops/sec on the counter store, not storage.

## 3. API surface

- **Strong**: Specifies the contract as response headers/behavior, not endpoints —
  this system doesn't expose a CRUD API, it decorates every API response. Names
  concrete headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset` or `Retry-After`) and a 429 status with a body explaining
  which limit was hit (per-client vs global). Also specifies an internal-facing
  surface: how an API server instance asks the limiter "allow or deny," including
  what it does if that call itself times out.
- **Adequate**: Mentions 429 and a `Retry-After` header but doesn't work out what
  the API server does when the limiter check itself fails or is slow.
- **Thin**: Says "return an error when over the limit" with no header or status
  code detail, or no discussion of the client-facing contract at all.
- **Absent**: No mention of what a caller sees, in success or failure.
- **Commonly missed**: that the limiter needs a "fail open vs fail closed" answer
  as part of the contract — what does the API server do if it can't reach the
  counter store in time to make a decision.

## 4. Data model

- **Strong**: Names a specific store (Redis, in-memory per-instance, or both) and
  justifies it against the estimation numbers — e.g. "Redis because we need a
  single shared view of each client's counter across dozens of API instances, and
  the ~20MB working set with sub-millisecond ops fits comfortably." Specifies the
  actual key structure (e.g. `ratelimit:{client_id}:{window_bucket}`) and what
  algorithm-specific state that key holds — a single counter with TTL for fixed
  window, a sorted set of timestamps for sliding log, or two adjacent window
  counters for sliding window counter. Explains what happens on key expiry.
- **Adequate**: Names Redis and a rough key shape but doesn't connect the data
  structure choice to the algorithm's mechanics (e.g. says "store counts in Redis"
  without saying what a sliding log actually needs to store).
- **Thin**: "Store counts somewhere" with no store named and no key structure.
- **Absent**: No data model at all — algorithm discussed purely in the abstract.
- **Commonly missed**: that a naive per-request Redis `INCR` plus a separate `EXPIRE`
  call is not atomic and needs a Lua script or `INCR`+`GET`+conditional TTL
  handled carefully, or that sliding-log storage (a sorted set per client) grows
  with request rate, not just client count, and needs active trimming.

## 5. Scale path

- **Strong**: Identifies that a single Redis instance is the first thing to break
  as traffic grows past current estimates (single-threaded ops/sec ceiling, not
  memory), and gives the actual next step: sharding by client ID hash across
  multiple Redis nodes/Cluster, or moving global-limit enforcement to a
  coarser-grained, less precise mechanism (token buckets refilled locally with
  periodic reconciliation) once perfect global accuracy stops being affordable.
  Names what changes at 10x (50k -> 500k req/s) versus 100x, not just "add more
  Redis."
- **Adequate**: Says "shard Redis" or "add read replicas" without identifying which
  resource (ops/sec vs memory vs network) actually runs out first.
- **Thin**: "Scale horizontally" with no specific bottleneck named.
- **Absent**: No discussion of what happens as load grows.
- **Commonly missed**: that Redis read replicas don't help here because rate
  limiting is a read-modify-write on every request — the bottleneck is write
  throughput on the primary (or the coordination cost of a cluster), not read
  fan-out. Also missed: local/per-instance approximate limiting (each API node
  keeps a local budget, reconciled periodically) as a way to trade strict accuracy
  for removing the shared-store round-trip from the hot path entirely.

## 6. Failure modes

- **Strong**: Works through what happens when the shared counter store (Redis) is
  unreachable or slow, and makes an explicit fail-open vs fail-closed call with a
  reason — e.g. "fail open for the per-client limit (availability over strictness,
  since a short window of unlimited traffic from good-faith clients is cheaper
  than false 429s) but fail closed or fall back to a conservative local limit for
  the global limit (protecting the backend matters more than one client's
  fairness)." Also covers a network partition where some API instances can't
  reach the counter store while others can, producing inconsistent enforcement,
  and what mitigates that (e.g. local fallback limits, health-check based
  routing).
- **Adequate**: States fail-open or fail-closed but picks one uniformly for both
  per-client and global limits without noticing they warrant different answers.
- **Thin**: Mentions "if Redis goes down we have a problem" without saying what the
  system actually does.
- **Absent**: No failure discussion; design only covers the happy path.
- **Commonly missed**: that a client who gets falsely rate-limited during a Redis
  blip has no way to distinguish that from a legitimate quota breach unless the
  error response says so, and that clock skew across API instances breaks
  fixed-window algorithms at the boundary in ways sliding approaches don't.

## 7. Tradeoffs

- **Strong**: Compares fixed window, sliding log, sliding window counter, and token
  bucket concretely against each other on accuracy vs memory vs compute, and picks
  one (or a hybrid) with a stated reason tied to this system's numbers — e.g.
  "sliding window counter: bounded memory like fixed window (two counters per
  client) but smooths the boundary-burst problem well enough for our accuracy
  needs, and sliding log's O(requests) memory per client is wasteful at 50k
  req/s." Explicitly names the fixed-window boundary-burst flaw (2x the limit
  possible across a window edge) as the reason it's rejected, not just "it's less
  accurate."
- **Adequate**: Names two or more algorithms and states one is "more accurate" or
  "cheaper" without quantifying the difference or connecting it to this system's
  actual traffic pattern.
- **Thin**: Names one algorithm with no comparison to alternatives.
- **Absent**: No algorithm named, or "we'll use rate limiting" with no mechanism.
- **Commonly missed**: that token bucket and sliding window counter solve
  different problems — token bucket naturally supports bursting up to a
  configurable ceiling (useful for the "allow burst but cap sustained rate" case),
  while sliding window counter approximates a smooth rolling limit with no burst
  allowance. Candidates often present them as interchangeable when the choice
  should depend on whether bursting above the steady-state rate is desired
  behavior or a bug to prevent.
