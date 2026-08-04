# Reference Design: Metrics and Telemetry Ingestion Pipeline

This is a worked design, not the only correct one. Read it after your own
attempt, not before.

## 1. Requirements

**Functional**: agents on every host emit metrics (numeric time series),
traces (spans), and logs (text). The system ingests all three, stores them,
and serves two consumer classes: interactive dashboards (bounded, repeated
queries, sub-second-to-low-seconds latency expected) and an alerting engine
(continuous rule evaluation over the freshest data available).

**Non-functional**:
- Ingest must never apply backpressure all the way to the host process being
  monitored — a slow metrics pipeline must not slow down the application
  emitting the metrics.
- Query latency for a single dashboard panel (one series or a small
  aggregate over ~50 series, 1-24h window): p99 under 1s.
- Full resolution retained 24-48h; downsampled retained 13 months.
- Durability: losing a few seconds of the most recent points during a node
  failure is acceptable (this is monitoring, not billing); silently losing
  hours of data, or losing it without any signal that data was lost, is not.

**Explicit non-goals**: full-text log search (treated as a lighter-weight
sibling pipeline, not designed in depth here); the agent itself; long-term
trace storage beyond what's needed for a single distributed-trace lookup
during an incident (assume traces get a shorter, separate retention window).

Metrics get by far the most design attention below because they're the
dimension that breaks in the specific, gnarly way this domain is known
for — cardinality. Traces and logs are addressed but more briefly.

## 2. Estimation

**Series count.** 50,000 hosts × ~20 processes/host × ~30 series/process
(a handful of counters, gauges, and histogram buckets per process) ≈ **30
million active series** at steady state. This is the number that matters
most — not point rate — because it drives index size and memory footprint.

**Point rate.** 30M series × 1 point per 10s scrape interval = **3M
points/sec** written, fleet-wide.

**Bytes.** A well-compressed time-series point (delta-of-delta timestamp +
XOR-compressed float, Gorilla-style) costs roughly 1-2 bytes amortized per
point in the hot tier. 3M points/sec × ~1.5 bytes ≈ 4.5 MB/sec ≈ **390 GB/day**
at full resolution, fleet-wide. Retained 48h at full resolution ≈ ~800 GB hot.
After downsampling to 1-minute resolution for long-term storage (6x
reduction) and further to 1-hour after 30 days, 13 months of history lands
in the tens-of-TB range, cheaply stored in object storage/columnar format —
this is what justifies a cold tier distinct from the hot tier.

**Traces.** Low tens of thousands of req/sec fleet-wide, 1% sampled ≈
100-300 spans/sec kept. Small relative to metrics; traces are indexed by
trace ID, not queried as time series, so they get a separate storage shape
(a key-value/blob store keyed by trace ID, with a secondary index for
service-name + time-range lookups) rather than reusing the metrics engine.

**Logs.** A few KB/sec/host baseline × 50,000 hosts ≈ 100-150 MB/sec
baseline, bursting several times higher during incidents — which is exactly
when the system most needs to keep accepting writes. This sizes the log
ingestion path independently from metrics; logs are line-oriented and
compress well (10x+) but the *write* volume, not the query pattern, is the
sizing constraint.

**Cardinality risk.** 30M series is the *intended* number. A single bad
deploy that adds `user_id` or `pod_name` (in a fleet doing rolling
deployments, pod names are effectively unique per deploy) to a metric that
used to have 3 tag values can turn one series into millions, overnight. The
design has to survive this without every other tenant's queries getting
slow — this is the central problem statement for the whole system, not an
edge case.

## 3. API surface

**Ingest (push)**: agents push over an OTLP-shaped protocol (protobuf over
gRPC, or the OTel HTTP/JSON equivalent) to a regional collector fleet:

```
POST /v1/metrics
{ metric: "http.request.duration", tags: {host, region, az, service, route},
  type: histogram, timestamp, value/buckets }
```

Push, not pull (Prometheus-style scrape), because at 50k hosts a central
scraper fleet becomes a discovery and connection-management problem of its
own; push lets each host own its own delivery and retry.

Collector returns `202 Accepted` on success. Under overload it returns `429`
with a `Retry-After` hint; the agent buffers locally (bounded ring buffer,
oldest-dropped) and retries with jitter. This is the backpressure contract:
push failures are visible to the agent, not silently swallowed by the
server.

**Query (read)**:

```
POST /v1/query
{ query: "avg(http.request.duration{service=checkout}) by (route)",
  start, end, step }
```

A PromQL-shaped query language: series selector + aggregation + group-by.
Dashboards issue queries with a bounded time range and a known, capped
series-fan-in (a panel is never allowed to expand to "all series matching
this selector" without a cap — the query planner rejects/warns above a
cardinality threshold, e.g. 10,000 series touched by one query). Ad hoc
exploration through the same endpoint but without the panel-level cap,
routed to a lower-priority query queue so a slow exploratory query can't
starve dashboard queries.

**Alerting**: a separate, continuously-running consumer, not a periodic
caller of the query API. It subscribes to a narrow set of rule-relevant
series (registered up front, not discovered per-evaluation) and evaluates
rules against the freshest data in the hot tier, on its own evaluation
interval (typically 30-60s), independent of dashboard query load.

## 4. Data model

**Two structures, deliberately separated: an index and a time-series store.**

**Index**: metric name + sorted tag set → series ID. This is what a
cardinality explosion actually stresses — every new distinct tag
combination is a new index entry. Implemented as an inverted index (each
tag key=value pair → set of series IDs containing it), so a query like
`service=checkout` resolves to a series ID set without scanning all 30M
series. This index lives in memory on the ingest/query tier, sharded, and
is the resource the cardinality-limiting logic below protects.

**Time-series data**: series ID + time bucket → compressed block of
(timestamp, value) pairs, using delta-of-delta timestamp encoding and
XOR/Gorilla-style value compression (this is what an LSM-tree-based or
purpose-built TSDB engine — think the internals of something in the
Prometheus/M3/Mimir/InfluxDB family — is built around: append-mostly,
time-ordered writes, range scans by time for reads). Chosen over a
general-purpose row store because the access pattern is almost entirely
"append the newest point for many series" and "scan a time range for one or
a few series" — an LSM/columnar layout with time as the sort key serves
both without the random-write amplification a B-tree-indexed OLTP store
would incur at this write rate.

**Hot tier**: last 24-48h, full resolution, on local SSD/NVMe close to the
ingest+query nodes, index fully in memory.

**Cold tier**: older data, downsampled (1-min resolution after 48h, 1-hour
after 30 days), written as columnar blocks (Parquet-shaped) to object
storage. A background compaction/downsampling job reads hot-tier blocks as
they age out, computes rollups (min/max/avg/count per bucket, not just
avg — losing min/max loses the ability to see spikes later), and writes the
downsampled columnar block, then the hot copy is deleted once the cold copy
is durably written and the retention window has passed.

**Cardinality control at write time**: each tenant/team gets a series
budget. A new tag combination that would exceed the budget is rejected at
the collector (metric still counted in aggregate, but the new series is not
created) and surfaced as a specific, visible signal — a `cardinality_limit
_exceeded` counter the team can see and alert on themselves — rather than
silently dropped or silently accepted into an unbounded index. This is the
single most important design decision in the whole system: cardinality is
controlled by refusing to create the runaway series in the first place, not
by trying to make an unbounded index performant.

## 5. Scale path

**At 10x hosts (500k)**: the ingest tier's aggregate write throughput
(30M/sec-ish points) is the first thing to feel it, but it's horizontally
shardable — shard by a hash of (metric name, tag set) so any given series
always lands on the same ingest/index shard, and add ingest nodes. The
sharper problem at 10x is the *index*: a naive shard-by-host-or-region key
concentrates all series for one region's traffic spike on one shard (hot
shard), so the shard key must be the series identity itself (hash of
metric+tags), not a host or region field, precisely because those fields
correlate with real-world bursts.

**At 100x (5M hosts, hypothetical)**: single-node in-memory index no longer
fits regardless of sharding granularity per node; the index itself needs to
be a distributed service with its own replication and shard-rebalancing,
and query fan-out (a query touching series across many shards) becomes the
bottleneck instead of ingest. At this scale, per-tenant cardinality budgets
stop being a nice-to-have and become the only thing standing between one
bad deploy and a global index that can't hold all its shards in memory
anywhere.

## 6. Failure modes

**Ingest node dies mid-write.** Points in flight to that node are lost;
agent's local retry buffer resends anything not yet `202`-acked, so loss is
bounded to sub-second in-flight data, not the buffer contents. Ingest nodes
are stateless relays in front of the storage layer (they don't hold data
themselves beyond a short write-ahead buffer), so a dead node is replaced
without a data-recovery step — just re-routed traffic.

**Storage layer falls behind ingestion (the backpressure case named in the
prompt).** A message broker (something Kafka/Pulsar-shaped, chosen
specifically for its ability to hold hours of backlog cheaply and let
consumers replay from an offset) sits between ingest and the storage
writers. Ingest nodes write to the broker, which can absorb a burst far
larger than the storage writers' steady-state throughput; storage writers
consume at their own sustainable rate. If the backlog itself grows past a
threshold (storage has been degraded for a sustained period, not just a
blip), the system sheds load by tightening cardinality budgets or dropping
the least-important tenants' data first (configurable priority) rather than
falling over for everyone uniformly. Without this broker, the design has no
answer for "ingestion outpaces storage" beyond "the ingest nodes reject
everything," which turns a storage slowdown into a total, fleet-wide outage
during exactly the incident when data is most needed.

**Query path degraded.** Dashboards fall back to cached/last-known-good
panel results with a visible staleness indicator, rather than an error page;
alerting, which is more latency-sensitive, is served off a narrower,
dedicated set of query resources so a flood of human dashboard traffic
during an incident can't starve the alert evaluator that's supposed to be
telling people about the incident.

**Alerting sees a gap in data.** A rule evaluator that gets no data for a
series it expects (rather than a value) treats "no data" as a distinct
signal from "value is below threshold" — typically firing a lower-severity
"missing data" alert after a grace period, rather than silently evaluating
against stale data as if it were current, which would produce false
negatives exactly when the pipeline itself is unhealthy.

## 7. Tradeoffs

**Reject over-cardinality series at ingest vs. let storage absorb unbounded
cardinality.** Rejected the latter: an unbounded index degrades every
tenant's queries, not just the one that caused the explosion, and by the
time it's visibly a problem the index is already too large to easily
shrink. A per-tenant budget with a visible rejection signal costs one team
some data on one bad metric; an unbounded index risks a fleet-wide outage.

**Push vs. pull (agent-initiated vs. server-scrape).** Considered a
Prometheus-style pull model. Rejected at this host count because a central
scraper fleet must discover and hold connections to 50k+ targets and
degrades in a correlated way (scraper fleet issues affect everyone at once);
push lets each host degrade independently and lets the agent make its own
local buffering decision when it can't reach a collector.

**General-purpose OLTP row store (e.g. a relational database) vs. a
time-series-shaped store for the hot tier.** Rejected the row store: the
write pattern here is overwhelmingly append-newest-point-for-many-series,
and the read pattern is time-range-scan-per-series — a B-tree-indexed
row store optimized for point lookups by primary key pays random-write
amplification for a workload that's naturally sequential-by-time, and gets
none of the columnar compression benefit that a time-ordered, append-only
layout gets almost for free.

**A message broker as the ingest/storage decoupling layer vs. writing
straight from ingest nodes to the storage engine.** Chose to decouple with
a broker specifically so a storage slowdown becomes "growing backlog,
consumed at a sustainable rate" instead of "ingest starts rejecting
everything." The tradeoff is added operational complexity (another stateful
system to run) and end-to-end latency (data isn't queryable the instant it's
written, it's queryable once the storage writer has consumed it) — accepted
because monitoring data that's a few seconds delayed during a storage
hiccup is far better than monitoring data that's missing entirely.

## What candidates typically get wrong

- **Sizing on point rate instead of series count.** Point rate tells you
  write throughput; series count tells you index size and is what actually
  breaks under a cardinality explosion. An answer that only ever says
  "X points/sec" and never says "Y series" hasn't found the real
  bottleneck of this domain.
- **Treating the index and the time-series data as one structure.** They
  have completely different growth characteristics and different failure
  modes — conflating them usually means the design has no specific answer
  for what a cardinality explosion actually does internally.
- **No answer for backpressure beyond "add more storage nodes."** Adding
  capacity is not a backpressure design; it doesn't answer what happens in
  the seconds-to-minutes between the burst starting and the new capacity
  being live. A broker or equivalent buffering layer is the actual answer.
- **Silently accepting or silently dropping over-cardinality series.**
  Both are worse than reject-with-signal: silent acceptance degrades
  everyone, silent dropping means the team that caused it never finds out
  and does it again next deploy.
- **Choosing "use Prometheus" or "use Datadog" as the entire answer.**
  Naming a real product isn't wrong, but an interviewer wants the internals
  the product embodies — the LSM/columnar layout, the index/data split, the
  cardinality-limiting policy — not the brand name standing in for a design.
