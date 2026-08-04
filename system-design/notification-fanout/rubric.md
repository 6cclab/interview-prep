# Rubric: Notification Fanout System

Score each dimension strong / adequate / thin / absent. One sentence of evidence per
rating, quoting the attempt's own words. No score without a quote.

## 1. Requirements clarification

- **Strong**: Separates the two fundamentally different event shapes up front —
  single-user targeted events (order shipped) vs mass-fanout events (viral post,
  broadcast) — and notes they likely need different pipelines or at least
  different fanout strategies, not one code path. States an explicit non-goal
  (e.g. "not building the in-app feed UI, only getting the notification
  delivered and stored"). Distinguishes "sent to provider" from "delivered" as
  two different states worth tracking separately.
- **Adequate**: Asks about channels and preferences but treats all events as
  roughly the same shape/size.
- **Thin**: Restates the prompt's feature list without identifying which
  requirement is the hard one (fanout scale, dedup, or provider failure).
- **Absent**: Starts naming a message queue before establishing what varies
  between event types.
- **Commonly missed**: that "delivered" is channel-specific and asymmetric — push
  has provider-level delivery receipts, SMS often doesn't beyond "accepted by
  carrier," email has opens/bounces on a delay — and the system needs a model that
  tolerates different confidence levels per channel rather than one boolean.

## 2. Back-of-envelope estimation

- **Strong**: Works the fanout math explicitly — 20k events/s average, but the
  large-fanout case (one event, 5-10M users, 2.5 channels each) means a single
  event can produce 12.5-25M individual delivery tasks. If that fanout needs to
  complete within, say, a few minutes for relevance, that's on the order of
  100k-200k delivery tasks/second sustained just from one event, dwarfing the
  steady 20k events/s x 2.5 = 50k/s baseline. Concludes the system must be sized
  for fanout *bursts*, not average event rate. Distinguishes storage (durable
  notification records: 500M users x some retention window) from throughput
  (delivery tasks/sec) as different constraints.
- **Adequate**: Cites the 20k events/s and 500M users numbers but doesn't compute
  what a single large-fanout event costs in delivery tasks.
- **Thin**: A number is mentioned once and doesn't inform any subsequent design
  decision.
- **Absent**: No estimation at all.
- **Commonly missed**: that average event rate (20k/s) is the wrong number to
  design the fanout path around — the tail event (one post to 10M followers) is
  the actual peak load generator and needs to be modeled explicitly, or the
  design under-provisions for exactly the case the prompt calls out.

## 3. API surface

- **Strong**: Specifies both the ingest side (how a producing service reports an
  event: `POST /events {type, actor, target_ref, audience_ref}` where
  `audience_ref` for a mass event is a reference to a followers/segment list, not
  an inline array of millions of user IDs) and the read/ack side (how a client
  fetches undelivered in-app notifications, how a delivery provider webhook
  reports delivery/bounce status back in). Explicitly notes that a mass-fanout
  event must NOT be submitted as a synchronous call carrying the full audience
  list — the audience is resolved downstream.
- **Adequate**: Specifies an ingest endpoint but has the caller enumerate the
  audience inline, missing that for 10M-user fanout this is itself the wrong
  shape.
- **Thin**: One endpoint sketched with no distinction between event ingest and
  delivery status callback.
- **Absent**: No concrete API — only prose about "the system receives events."
- **Commonly missed**: a webhook/callback contract for provider delivery
  receipts (push/email providers report async status after the fact — the system
  needs an endpoint to receive that, not just a fire-and-forget send call).

## 4. Data model

- **Strong**: Separates at least three concerns with distinct storage
  characteristics: (a) the notification/event record itself (what happened, who
  triggered it) — durable, moderate volume; (b) per-user delivery state
  (notification_id x user_id x channel -> status) — very high volume, the actual
  fanout output, candidate for a wide-column/KV store like DynamoDB/Cassandra
  keyed by user_id for fast "my notifications" reads; (c) user preference/quiet-
  hours config — small, low-write, high-read, cacheable, fits Postgres/Redis.
  Justifies the store choice for (b) specifically against the 100k+/s write rate
  from large-fanout bursts — a relational store with per-row transactional
  writes at that volume is the wrong tool.
- **Adequate**: Names a couple of stores (e.g. "Postgres for preferences, a queue
  for delivery") but doesn't size the per-user delivery-state store against the
  fanout write volume.
- **Thin**: "Store notifications in a database" with no distinction between event
  records, per-user delivery state, and preferences.
- **Absent**: No data model discussion.
- **Commonly missed**: that per-user delivery state at this scale (25M rows from
  one event) is the actual hot path and dominant volume — not the event record
  itself, which is one row per event — and that this asymmetry should drive the
  storage choice, not an assumption that "the database" is one uniform thing.

## 5. Scale path

- **Strong**: Identifies that the fanout *expansion* step — turning one event
  into millions of per-user delivery tasks — is the first thing to break, and
  proposes a concrete mechanism: a fanout worker pool consuming from a queue,
  paginating the audience list (e.g. follower list read in batches of 1,000) and
  emitting per-user delivery tasks onto per-channel queues, parallelized across
  many workers. Names the specific next bottleneck after that (per-channel
  provider throughput/rate limits — see Failure Modes) as a *second*, independent
  ceiling from the fanout expansion itself. Discusses 10x/100x: at 10x the
  fanout-worker pool and queue partitioning scale roughly linearly; at 100x
  (~1-2.5B delivery tasks from one mega-event) the design needs to consider
  whether every user truly needs a synchronous fanout at all, versus batching /
  precomputing "hot" segments.
- **Adequate**: Says "use a queue and scale consumers" without identifying fanout
  expansion specifically as the first bottleneck, or conflates it with the
  provider-rate-limit bottleneck.
- **Thin**: "Add more servers" with no specific stage of the pipeline named.
- **Absent**: No scale-path discussion.
- **Commonly missed**: that fan-out-on-write (precompute every user's delivery
  task immediately) and fan-out-on-read (compute lazily when a low-follower-count
  user checks their feed) are a real tradeoff for the in-app channel
  specifically, mirroring the classic social-feed fanout problem — candidates
  who've done a "design Twitter timeline" drill before often fail to connect it
  here even though it's the same shape for in-app notifications from
  high-follower accounts.

## 6. Failure modes

- **Strong**: Covers each provider independently rather than "third parties can
  fail" generically — push provider (APNs/FCM) down or rate-limiting: queue and
  retry with backoff, since push is not time-critical to the second; SMS
  provider down: this is often used for urgent/transactional content, so name a
  fallback channel or an alerting path rather than silent queueing; email
  provider degraded: least time-sensitive, longest acceptable retry window.
  Covers the fanout pipeline's own dependencies: what happens if the
  audience/follower-list service is down mid-fanout (partial fanout — some users
  got notified, others didn't, and the system needs to know where it left off to
  resume, not restart from zero). Discusses provider rate limits explicitly as a
  *normal operating condition* to design around (token-bucket pacing per
  provider), not just an outage.
- **Adequate**: Says "retry with backoff" as a blanket answer for all providers
  without differentiating urgency or failure characteristics per channel.
- **Thin**: "If a provider is down we retry" with no mechanism or per-channel
  distinction.
- **Absent**: No failure-mode discussion; only happy path.
- **Commonly missed**: that provider rate-limiting during a large fanout burst is
  not an edge case but the expected steady state — a 10M-user push fanout will
  routinely exceed APNs/FCM's per-app rate limits, so the delivery worker needs
  built-in pacing/backpressure against each provider's known limits, not just
  error-triggered retry.

## 7. Tradeoffs

- **Strong**: Names and picks between at least two real alternatives with
  reasoning tied to this system: (a) delivery-guarantee choice — at-least-once
  with idempotent consumers (dedup via a `notification_id + user_id + channel`
  key, e.g. a unique constraint or a dedup cache with short TTL) versus
  exactly-once messaging infra, explicitly rejecting exactly-once as unnecessary
  complexity given idempotent writes solve the duplicate-delivery requirement
  more cheaply; (b) fanout timing — fanout-on-write (precompute per-user tasks
  immediately) versus fanout-on-read (resolve lazily at read time for very
  large/low-engagement audiences) for the in-app channel, and which user
  population each suits; (c) ordering — per-user delivery order matters (don't
  show a "comment deleted" notification before "comment posted") but global
  ordering across users doesn't, so the design uses per-user-partitioned queues
  rather than a single strictly-ordered log.
- **Adequate**: Names one alternative (e.g. "could do exactly-once but that's
  expensive, we'll use at-least-once") without working out the idempotency
  mechanism that makes at-least-once safe.
- **Thin**: Mentions "we could do it another way" with no concrete alternative or
  reasoning.
- **Absent**: No tradeoffs discussed; one approach presented as the only option.
- **Commonly missed**: idempotency is not automatically solved by "using a
  message queue with retries" — candidates often say "the queue handles retries"
  and stop, without specifying the actual dedup key/mechanism that makes a
  redelivered message a no-op rather than a duplicate notification.
