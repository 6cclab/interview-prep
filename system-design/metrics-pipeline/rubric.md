# Rubric: Metrics and Telemetry Ingestion Pipeline

Score each dimension **strong / adequate / thin / absent**. One sentence of
evidence per rating, quoting the attempt's own words. No score without a
quote — if you can't find a quote that supports the rating, the rating is
wrong.

Calibration note: he has built a developer-telemetry platform and runs
Datadog/OpenTelemetry in production. Do not give credit for describing agents,
scrape loops, or dashboards competently — that's assumed baseline. Grade this
one hard on cardinality control and time-series storage engine internals,
which are the parts he has consumed as a user, not built.

---

## 1. Requirements clarification

- **Strong**: separates metrics, traces, and logs explicitly and says they
  have different volume/cardinality/query profiles and may deserve different
  storage; states an explicit resolution requirement (e.g. "full resolution
  for 24-48h, then downsampled") before designing storage; states a query
  latency target for dashboards distinct from ad hoc queries; states a
  non-goal (e.g. "not designing full-text log search").
- **Adequate**: asks read vs write ratio and rough scale, but treats metrics,
  traces, and logs as one undifferentiated blob for the rest of the design.
- **Thin**: jumps straight to "agents send data to a collector" without
  stating what's being optimized for or what's explicitly out of scope.
- **Absent**: no scoping before architecture appears.
- **Common miss**: conflating "ingest fast" with "query fast" as the same
  requirement — they pull the storage design in different directions and a
  strong answer names the tension explicitly.

## 2. Back-of-envelope estimation

- **Strong**: derives series count and point rate from the given numbers —
  e.g. 50,000 hosts × 20 processes × ~30 series/process ≈ 30M active series,
  at a 10s scrape interval ≈ 3M points/sec — and uses that number to justify
  a design decision downstream (partitioning, write-path sizing, cardinality
  budget). Also estimates storage growth (bytes/point × points/day × retention)
  and gets to a number in the TB-to-PB range with units labeled.
- **Adequate**: computes one of {series count, point rate, storage growth} but
  not the others, or computes them but never references the number again.
- **Thin**: a single vague number ("millions of metrics") with no derivation.
- **Absent**: no numbers anywhere in the attempt.
- **Common miss**: estimating points/sec but never converting to *series*
  count — series count, not point rate, is what drives cardinality problems
  and index/memory sizing, and is the number this domain actually breaks on.

## 3. API surface

- **Strong**: defines the write path (e.g. an OTLP/StatsD/Prometheus-remote-write-shaped
  ingest endpoint with metric name, tag set, timestamp, value, and says
  whether it's push or pull and why) and the read path separately — a query
  language or endpoint with time range, series selector, and aggregation
  function, distinguishing a dashboard query (bounded, cacheable) from an ad
  hoc exploratory query (unbounded, expensive). Says what backpressure signal
  the write endpoint returns when the store is overloaded (e.g. 429 with
  retry-after, or silent sampling) rather than assuming infinite acceptance.
- **Adequate**: defines a write endpoint and a read endpoint but doesn't
  address what either does under overload.
- **Thin**: mentions "agents push metrics to a collector" with no shape to
  the message or query.
- **Absent**: no API described.
- **Common miss**: designing the write API but never specifying what the
  *query* API returns when data has been downsampled — does a query spanning
  a downsampled window return one value per hour, or does the API hide that
  from the caller?

## 4. Data model

- **Strong**: names a specific storage engine class (e.g. an LSM-tree-based
  time-series store, or a columnar store with delta/gorilla-style
  compression) and explains *why* that shape suits high-cardinality,
  append-mostly, time-ordered numeric data specifically — not just "a
  database." States the key structure (something like metric name + sorted
  tag set → series ID, then series ID + time bucket → compressed block) and
  explicitly separates an inverted index (name/tags → series ID) from the
  time-series data itself. Addresses hot (recent, in-memory or fast SSD) vs
  cold (object storage, columnar, downsampled) explicitly, with what triggers
  the move between tiers.
- **Adequate**: picks a real time-series-shaped store (e.g. names something
  like a TSDB) but treats it as a black box — no explanation of the index/data
  split or why the storage layout suits the write pattern.
- **Thin**: "store metrics in a database" with no index structure and no
  hot/cold distinction.
- **Absent**: no data model.
- **Common miss**: not separating the tag index from the raw time-series
  data — this is exactly the seam where cardinality explosions cause damage
  (index bloats, not the raw values), and someone with dashboard-consumer
  experience but not storage-engine experience often skips it.

## 5. Scale path

- **Strong**: names what breaks first at 10x (e.g. a single ingest node's
  network/CPU, or a hot shard from an unevenly-distributed tag like region)
  and at 100x (e.g. the tag index no longer fits in memory on one node, cross-
  shard queries become the bottleneck) and describes the specific change —
  sharding series across ingest nodes by a hash of the series key, splitting
  the index into its own horizontally-scaled tier, etc.
- **Adequate**: says "add more nodes" / "shard it" without saying what's
  sharded on what key or why that key avoids hot spots.
- **Thin**: asserts the design scales without identifying a bottleneck.
- **Absent**: scale never discussed beyond the initial numbers.
- **Common miss**: sharding metrics by host or by time without checking
  whether that key produces hot shards (e.g. all series for one region firing
  at once, or a fixed time-bucket key concentrating all current writes on one
  shard) — the "obvious" shard key is often the wrong one here.

## 6. Failure modes

- **Strong**: covers at least: (a) an ingest node dies mid-write — what data
  is lost, if any, and how the agent/collector detects and retries; (b) the
  storage layer falls behind or is unreachable — what backpressure or
  buffering happens upstream (local agent buffer, message broker, or
  load-shedding) and what's the policy when the buffer itself fills; (c) a
  query node or the whole query path is degraded — do dashboards fail
  entirely, serve stale data, or degrade to fewer series; (d) the alerting
  consumer sees a gap in data — does it fire a "no data" alert, suppress, or
  guess. Each is a distinct partial-failure story, not "the system is
  redundant."
- **Adequate**: covers 2 of the 4 above concretely.
- **Thin**: gestures at "replication handles failures" with no scenario.
- **Absent**: no failure modes discussed.
- **Common miss**: not addressing what happens when *ingestion outpaces
  storage* specifically (this is named in the prompt) — most answers cover
  node death but skip the sustained-overload case, which is the one that
  actually happens during an incident, i.e. exactly when dashboards matter
  most.

## 7. Tradeoffs

- **Strong**: for at least two real decisions, states the alternative
  considered and the concrete reason it was rejected for *this* workload —
  e.g. "a general-purpose OLTP row store was rejected because point lookups
  by primary key aren't the access pattern; time-ordered scans by series are"
  or "chose to push cardinality limits at ingest (reject/drop over-cardinality
  series) over trying to handle unbounded cardinality in storage, because the
  failure mode of an uncontrolled index is worse than dropping one bad
  series." Reasoning about a message broker's *role* (buffering, decoupling
  ingest rate from storage write rate, replay on downstream failure) even
  without deep Kafka-specific mechanics counts as strong here — the role
  matters more than naming the exact product.
- **Adequate**: names an alternative but the rejection reason is generic
  ("it wouldn't scale") rather than tied to this workload's access pattern.
- **Thin**: only one path is ever discussed, no alternative named.
- **Absent**: no tradeoffs section.
- **Common miss**: not addressing the cardinality tradeoff directly — reject
  at ingest and lose data vs. accept and let the index/storage layer absorb
  the cost. Silence on this is itself a finding, since cardinality is the
  defining problem of this domain and every real system has an opinionated
  answer.
