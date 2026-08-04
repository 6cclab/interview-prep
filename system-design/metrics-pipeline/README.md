# Metrics and Telemetry Ingestion Pipeline

Design the backend that collects metrics, traces, and logs from a large fleet of
hosts and makes them queryable for dashboards and alerting.

## Scope

An agent runs on every host. It emits:

- **Metrics** — numeric time series, e.g. `cpu.usage{host,region,az}`, request
  latency histograms, counters. Each unique combination of metric name and tag
  values is a distinct time series.
- **Traces** — spans for individual requests, sampled.
- **Logs** — unstructured or semi-structured text lines.

Design the path from agent to durable storage to query, for all three, though you
should expect metrics to dominate the design discussion. Cover:

- **Ingestion** — how data gets from tens of thousands of hosts into the system
  without any single host or agent needing to know about the system's internal
  topology.
- **Cardinality** — what happens when the number of distinct time series grows
  far faster than anyone intended, and how the system behaves when it does.
- **Storage** — what's hot (recent, high-resolution, queried constantly) versus
  cold (old, downsampled, queried rarely), and what physically backs each tier.
- **Retention and downsampling** — data doesn't stay at full resolution forever;
  define the policy and how it's enforced.
- **Backpressure** — ingestion rate is bursty and storage write throughput is
  not infinite. Define what happens when the former outpaces the latter.
- **Query** — dashboards need results in around a second; ad hoc exploratory
  queries can tolerate more. Design for both.
- **Alerting** — a consumer of this data that needs to evaluate rules against
  it continuously, not just serve human queries.

## Scale to design for

- 5,000 hosts today, expected to reach 50,000 within two years.
- Each host runs ~20 processes, each emitting on the order of tens of metric
  series.
- Metrics are scraped or pushed on a 10-second interval.
- Traces: 1% sampling of a fleet doing low tens of thousands of requests/sec.
- Logs: a few KB/sec/host under normal conditions, bursty during incidents.
- Dashboards are viewed by on-call engineers during incidents — query latency
  matters most exactly when the system is under the most write load.
- Data needs to be queryable at full resolution for the last 24-48 hours, and
  in some usable (rolled up) form for 13 months for capacity planning.

## Non-goals (state your own, but at minimum)

- You do not need to design the agent itself (assume it exists and reliably
  forwards what it's given).
- You do not need to design a general-purpose log search product (Splunk-class
  full text search) — logs can be treated as a simpler, lower-priority sibling
  to metrics for this exercise.

## What the interviewer wants covered

A staff-level answer estimates before it designs, names a specific ingestion
protocol and storage engine (and says why), has an explicit answer for what
happens to cardinality when someone adds a high-cardinality tag like
`user_id` or `pod_name` by mistake, and can say precisely what breaks first
at 10x and 100x host count. "Use Prometheus" is not a design — explain what
Prometheus-shaped systems do internally and where they fall over, or design
around a specific alternative and justify it.

Bring your own numbers. If you don't state throughput, series count, or
storage growth anywhere, that's a gap an interviewer will notice even if the
architecture is otherwise sound.
