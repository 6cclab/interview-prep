# Reference Design: Multi-Engine File Scanning Service

This is a worked design, not the only correct one. Read it after your own
attempt, not before.

## 1. Requirements

**Functional**: accept file submissions; identify files by content; run each
distinct file through 60 engines; aggregate opinions into a verdict; serve
verdict lookups by hash; recompute verdicts when engines update.

**Two traffic classes, and they are not alike.**

| | Rate | Shape |
|---|---|---|
| Hash lookup | ~200x uploads → ~4,600/sec | read-only, cacheable, latency-sensitive |
| Submission | 2M/day → ~23/sec | write, expensive, ~85% resolve to a known file |

The lookup path is the product. The submission path is the cost centre. They
share a data store and almost nothing else.

**Non-functional**:
- Lookup p99 under 100 ms — it is a cache hit on a hash key and there is no
  excuse for more.
- A submission returns immediately with a handle; verdicts stream in.
- Verdict staleness bounded and *stated*, not accidental.
- Private submissions must not be discoverable by non-owners, including by
  timing.

**Non-goals**: engine internals, detection logic, UI.

## 2. Estimation

- 2M submissions/day, 85% already known → **300K new files/day ≈ 3.5/sec**.
- 3.5/sec × 60 engines ≈ **210 engine-invocations/sec** steady state.
- The 3 external engines cap at 25 rps each. 3.5 files/sec against a 25 rps cap
  is fine steady-state — **but see the burst case, where it is the binding
  constraint.**
- Storage: 300K/day × 300 KB median ≈ **90 GB/day ≈ 33 TB/year** of new
  distinct content. 2B files at median → order of **600 TB**. Object storage,
  tiered.
- Verdict rows: 2B files × 60 engines = **120B rows** if stored naively per
  (file, engine). This number is why §5 stores by signature-version rather than
  appending history per scan.
- **Burst**: a vendor invalidating 5M verdicts, at that vendor's share of
  throughput, is days of backfill. This sizes the system, not the steady state.

## 3. Identity: content addressing

**SHA-256, computed server-side, always.**

Upload is two-phase:

1. `HEAD /files/{sha256}` — client asserts a hash. If known *and the client is
   permitted to know* (see §6), respond 200 and skip the body. This is the
   bandwidth win on 85% of traffic.
2. Otherwise `POST /files` with the bytes. The server streams to object storage
   **and hashes as it streams**, then compares to the client's assertion. A
   mismatch is rejected, and the server's hash wins unconditionally.

**Never trust the client hash.** If a client can assert `sha256(known_clean)`
while sending malicious bytes, it gets a clean verdict permanently attached to
its payload — the whole system inverts into a laundering service. The pre-flight
in step 1 is safe precisely because it transfers no bytes; the moment bytes
arrive, identity is re-derived.

Collisions: SHA-256 preimage resistance is the guarantee being leaned on. For
defence in depth, store `(sha256, length)` and treat a length mismatch on an
existing hash as an alarm, not a merge.

Chunked/resumable upload: the hash is only known on completion, so writes land
at a temporary key and are moved to the content-addressed key at finalisation.
The move is metadata-only in most object stores.

## 4. Fan-out

Submission of a genuinely new file emits one `file.received` event. **The
dispatcher fans out per (file, engine) — 60 messages, not one.** Per-engine
queues, per-engine worker pools, per-engine concurrency limits.

Why per-engine rather than per-file: a single message that must visit 60 engines
takes p99 of the slowest every time and retries all 60 when one fails. Per-engine
messages fail and retry independently, and the 3 rate-limited external engines
get their own queue with a token bucket at 25 rps without throttling the other
57.

**Verdict lifecycle** is explicit and exposed:

```
pending   → no engine has reported
partial   → ≥1 reported, some outstanding
complete  → all reported, or outstanding ones exceeded their deadline
```

A lookup on a `partial` verdict returns what is known plus which engines are
outstanding. **An engine that times out marks itself `degraded` for that file
and the verdict still reaches `complete`** — 59 of 60 opinions is a usable
answer, and blocking forever on one crashed engine is the failure this avoids.

Scan workers are the concurrency knob: at 210 invocations/sec with p50 400 ms
and p99 90 s, sizing on p50 will collapse under a batch of slow files. Size on a
weighted mean, autoscale on queue depth per engine, and let the external-engine
queues stay deliberately shallow.

## 5. Verdict invalidation — the core of the problem

**A verdict is a function of `(file_hash, engine_id, signature_version)`.** Store
it that way. The current verdict for a file is the set of rows whose
`signature_version` equals each engine's current version.

When engine E publishes version N+1, **nothing is deleted and nothing is
immediately recomputed.** Every row for E at version N is now, by definition,
stale — this is a comparison, not a migration. That is the entire trick: a
vendor update is O(1) to record and the 120B-row table is never rewritten.

Recomputation is a **separate backfill lane**:

- Its own queue, its own worker pool, **hard-capped at a fraction of live
  capacity** (say 20%) so a vendor update can never starve live submissions.
- Prioritised, because 5M files cannot be done at once and order matters:
  1. files queried in the last 30 days — these are what people actually ask about
  2. files with an existing malicious or suspicious verdict — a downgrade to
     clean matters less than an upgrade to malicious
  3. everything else, indefinitely, as capacity allows
- Idempotent by construction: the write is keyed on
  `(file, engine, signature_version)`, so a re-delivered message overwrites
  itself rather than appending.

**What a lookup returns for a stale-but-not-recomputed verdict** is a product
decision that must be made explicitly: serve the last known verdict *with the
signature version and timestamp attached*, so the caller can judge. Silently
serving a year-old clean verdict as though it were current is the failure mode
this whole section exists to prevent.

History is bounded by retaining the current version per (file, engine) plus a
capped number of prior versions — full history for 2B files is not free and
nobody queries the 2023 opinion.

## 6. Tenancy and the dedup/privacy tension

**Physical layer dedupes. Visibility layer does not.**

- One blob per hash, globally, always. The economics require it.
- A separate `submission` record per (tenant, file, timestamp). Tenants see
  their own submissions. Dedup is invisible to them.
- Every file carries a visibility: `public` (verdict and existence are shared
  knowledge) or `private` (this tenant's business).

**The side channel is the pre-flight lookup, and an ACL check on read does not
close it.** If `HEAD /files/{hash}` returns fast for known files and slow for
unknown ones, an attacker with a candidate binary learns whether it exists in
the corpus — which for a customer's unreleased internal build is exactly the
leak they were promised would not happen.

Two acceptable resolutions, and the answer must pick one:

1. **Scope the fast path to public files.** `HEAD` answers "known" only for
   files with at least one public submission. A privately-submitted file reports
   unknown to everyone but its submitter, and re-upload costs bandwidth. Simple,
   leaks nothing, gives up some dedup *bandwidth* saving — but still dedupes
   storage and scanning, because the server discovers the collision after
   receiving the bytes.
2. **Normalise the response.** Always accept the upload, answer uniformly, and
   make the timing indistinguishable. Harder to get right and easy to regress.

Option 1 is the better default: it gives up the least valuable of the three
dedup wins (bandwidth) and keeps the two expensive ones (storage, scan cost).

## 7. Hostile input

The corpus is live malware, held deliberately.

- **Scan workers are sandboxed, network-isolated, single-use.** A worker
  processes one file and is destroyed — no reuse, so an escape cannot persist
  into the next tenant's file.
- Workers have no credentials beyond a scoped read of the one blob they were
  assigned and a write to a result queue. An escaped process should reach
  nothing.
- Stored blobs are **never served back over a public path** in original form.
  Downloads, if offered at all, are authenticated, rate-limited, logged, and
  password-protected-archive wrapped — otherwise the service is a
  high-availability malware CDN with someone else's brand on it.
- Object storage is separate from every other system, with its own credentials
  and no lifecycle rule that could copy content into a general-purpose bucket.

## 8. Storage

**Blobs**: object store, key = `sha256[0:2]/sha256[2:4]/sha256`, prefix-sharded
to avoid hot partitions. Lifecycle by last-access — cold files to infrequent
tiers, which is safe because access is overwhelmingly by hash lookup against
metadata, not by fetching bytes.

**Metadata and verdicts**: sharded by hash prefix. The hash is uniformly
distributed by construction, so this needs no rebalancing heuristics, and it is
also the dominant read key — a lookup touches exactly one shard, never a
scatter-gather.

**Lookup cache**: the read path is 4,600/sec on a key space with strong
locality (people query the same hashes). A cache in front of metadata absorbs
most of it. Invalidation is driven by the same events as §5, which is why the
signature-version model matters here too — the cache key includes it, so a
version bump is a natural miss rather than an explicit purge.

## 9. What breaks first

- **At 10x**: the external rate-limited engines. 25 rps against 35 new
  files/sec means those 3 engines are permanently behind, and the `complete`
  transition starts depending on a deadline rather than on their reporting.
  Negotiate the cap, cache their verdicts harder, or accept them as always-
  degraded.
- **At 100x**: verdict storage cardinality. 120B rows was already the awkward
  number; the answer is that verdict rows are not a relational workload and
  belong in a wide-column store keyed by hash.
- **Any scale, and the real one**: a vendor pushing an update that invalidates a
  large fraction of the corpus. The backfill lane's priority ordering is what
  keeps this a slow correctness convergence rather than an outage — which is why
  §5 is the dimension the rubric grades hardest.
