# Rubric: Multi-Engine File Scanning Service

Score each dimension **strong / adequate / thin / absent**. One sentence of
evidence per rating, quoting the attempt's own words. No score without a
quote — if you can't find a quote that supports the rating, the rating is
wrong.

Calibration note: he has built event-driven systems on SQS, an observability
platform, and org-wide rollout tooling, and he has led migrations where the
hard part was ordering and blast radius. Do not give credit for describing a
queue, a worker pool, or object storage competently — that is assumed baseline.
**Grade this one hard on three things he has not built: content addressing and
its collision/trust story, verdict invalidation when an engine updates, and the
dedup-versus-privacy trade-off.** Those are the parts of this problem that do
not transfer from what he already knows.

---

## 1. Requirements clarification

- **Strong**: separates the two traffic classes explicitly — hash lookups
  (dominant, ~200x uploads, cache-friendly, read-only) versus submissions
  (expensive, write path, fan-out) — and says they deserve different treatment
  before any architecture appears. States what a "verdict" means as a
  requirement rather than assuming it. Names a non-goal.
- **Adequate**: asks scale and read/write ratio, but treats lookup and
  submission as one undifferentiated API for the rest of the design.
- **Thin**: goes straight to "user uploads to S3, we queue a scan" without
  saying what is being optimised for.
- **Absent**: no scoping before architecture.
- **Common miss**: not noticing that the 85% already-seen rate means the *typical*
  submission does no scanning at all. If the design treats every submission as a
  scan trigger, the whole capacity model is wrong by roughly 7x.

## 2. Back-of-envelope estimation

- **Strong**: derives scan volume from the dedup rate — 2M submissions/day at
  85% duplicates ≈ 300K genuinely new files/day ≈ 3.5/sec sustained, times 60
  engines ≈ 200 engine-invocations/sec steady state — and uses it to size worker
  pools. Estimates storage from median size and corpus count and lands in the
  hundreds-of-TB range with units labelled. **Separately estimates the burst
  case**: a vendor update invalidating millions of verdicts, and what queue depth
  that implies against the same worker pool.
- **Adequate**: computes storage or throughput but not both, or computes steady
  state and never touches the invalidation burst.
- **Thin**: gestures at "millions of files" without arithmetic.
- **Absent**: no numbers.
- **Common miss**: sizing for steady state only. The invalidation burst is the
  capacity-defining event and it is stated in the prompt.

## 3. Content addressing and identity

- **Strong**: names a specific hash and defends it. **Says explicitly that the
  server must compute the hash itself and never trust a client-supplied one**,
  and explains the attack if it does — a client claiming a known-clean hash for
  malicious bytes gets a clean verdict attached to its file. Handles the
  chunked-upload case (hash known only after full receipt) without hand-waving.
  Addresses collision either by choice of hash strength or by storing a second
  discriminator.
- **Adequate**: picks SHA-256 and dedupes on it, mentions collisions are
  improbable, but never separates *client-asserted* identity from *server-verified*
  identity.
- **Thin**: "we hash the file and use that as the key," no threat consideration.
- **Absent**: no identity scheme; files keyed by name or upload id.
- **Common miss**: designing the bandwidth-saving "do you already have this
  hash?" pre-flight API and not noticing it is the same API an attacker uses to
  probe for file existence. Credit an answer that connects the two; this is the
  hinge between dimensions 3 and 6.

## 4. Scan fan-out and partial results

- **Strong**: fans out per-engine rather than per-file so one slow engine cannot
  block the other 59; treats the 3 rate-limited external engines as a distinct
  class with their own queue and concurrency budget. Defines an explicit
  verdict lifecycle — pending → partial → complete — and says what the API
  returns at each stage rather than blocking. Has an answer for an engine that
  never returns (timeout, mark degraded, verdict is complete-with-gaps not
  stuck-forever).
- **Adequate**: queues per file and collects results, notices the slow-engine
  problem, but returns only a terminal verdict so a caller waits on the p99
  engine.
- **Thin**: single queue, single worker type, engines called in a loop.
- **Absent**: no fan-out design.
- **Common miss**: treating a crashed or timed-out engine as a failed *scan*
  rather than a missing *opinion*. 59 of 60 reporting is a usable verdict.

## 5. Verdict invalidation and re-scan — **the hardest dimension, grade it hardest**

- **Strong**: recognises that a verdict is a function of (file, engine,
  signature-version) and stores it that way, so invalidation is a matter of
  marking a version stale rather than hunting for affected rows. Designs the
  backfill as a **separate, throttled, lower-priority lane** that cannot starve
  live submissions, and prioritises it by something defensible — recently
  queried files, high-fan-out files, customer tier. States explicitly what a
  lookup returns for a file whose verdict is known-stale but not yet recomputed.
- **Adequate**: recognises verdicts expire and proposes periodic re-scanning,
  but on a blanket TTL rather than driven by engine updates, and does not
  separate backfill traffic from live traffic.
- **Thin**: mentions verdicts can change; no mechanism.
- **Absent**: verdicts treated as immutable. **This is the single most common
  way to fail this problem**, because everything else can look correct while the
  system quietly serves year-old answers.
- **Common miss**: re-scanning *everything* on a vendor update. Two billion
  files times one engine is not a background task, it is an outage.

## 6. Tenancy, privacy, and the dedup trade-off

- **Strong**: states the tension in their own words and resolves it. A strong
  resolution separates the *physical* layer (one blob, deduped, shared) from the
  *visibility* layer (per-tenant submission records that do not leak existence),
  and closes the timing/latency side channel on the pre-flight API — either by
  scoping "already known" answers to public files only, or by normalising the
  response so a probe cannot distinguish. Names which submissions are public and
  which are private as a product decision, not an implementation detail.
- **Adequate**: notices private files need isolation and proposes separate
  storage for them, accepting the cost, without addressing the lookup side
  channel.
- **Thin**: mentions access control on the read API but dedupes globally with no
  further thought.
- **Absent**: no tenancy consideration. Note that for a security product this is
  not a nice-to-have — it is the failure that ends the customer relationship.
- **Common miss**: solving it with an ACL check on read while leaving the
  "we already have that hash, upload skipped" fast path observable. The response
  *time* is the leak.

## 7. Hostile input

- **Strong**: says plainly that the stored objects are live malware and designs
  accordingly — no execution on general-purpose infrastructure, sandboxed and
  network-isolated scan workers, treated as disposable and rebuilt rather than
  reused, blast radius bounded per scan. Mentions that stored blobs must not be
  served back in a way that lets the service become a malware CDN.
- **Adequate**: mentions sandboxing scan workers without saying what escape
  would cost or how workers are recycled.
- **Thin**: notes files are untrusted; no design consequence.
- **Absent**: files treated as ordinary blobs.
- **Common miss**: designing storage and fan-out perfectly and never once
  saying that the payload is hostile. This dimension is cheap to score well on
  and easy to forget entirely.

## 8. Storage and sharding

- **Strong**: separates blob storage (object store, content-addressed path,
  lifecycle/tiering by last-access) from metadata and verdict storage
  (sharded by hash prefix, which distributes uniformly by construction —
  and says so). Handles the wide row: one file, 60 engine verdicts, multiple
  signature versions over time, and how that is bounded.
- **Adequate**: picks object storage plus a sharded database and gives a
  sharding key, without discussing verdict-history growth.
- **Thin**: "put it in S3 and Postgres."
- **Absent**: no storage design.
- **Common miss**: sharding on something that is not the read key, forcing a
  scatter-gather on the dominant lookup path.

## 9. Communication and structure

- **Strong**: states assumptions before designing, drives the discussion in a
  visible order, flags trade-offs as trade-offs rather than presenting one
  option as the only choice, and says which parts are least certain. Answers
  "what breaks first at 10x" without being asked twice.
- **Adequate**: covers the ground when prompted; the interviewer is steering.
- **Thin**: jumps between layers; the listener has to reassemble the design.
- **Absent**: no discernible structure.
- **Common miss**: over-indexing on the parts already known well (queues,
  workers, object storage) and spending the back half of the session there
  rather than on dimensions 5 and 6, which are where the grade actually is.
