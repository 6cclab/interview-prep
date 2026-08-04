# Rubric: Developer Experience Telemetry Platform

Score each dimension **strong / adequate / thin / absent**. One sentence of
evidence per rating, quoting the attempt's own words. No score without a quote.

## 1. Requirements clarification

- **Strong** — Separates the three collection surfaces (dev-server/build
  telemetry, AI-assistant tool-use events, AI-assistant prompt content) as
  distinct problems with distinct sensitivity levels before designing a shared
  pipeline for all three. Explicitly asks what "surveillance" would mean to an
  engineer here, and treats that as a requirement to design against, not a PR
  concern to address after the architecture is fixed.
- **Adequate** — Notes there are multiple event sources but treats them uniformly
  without distinguishing sensitivity or collection mechanism.
- **Thin** — Jumps to "collect events, ship to a backend, build a dashboard"
  without separating what's being collected or asking why an engineer would
  object to any of it.
- **Common miss:** treating prompt content the same as a build-cache-hit counter
  — one is an operational metric, the other can contain arbitrary pasted code or
  secrets, and conflating them in the design is itself the trust failure.

## 2. Back-of-envelope estimation

- **Strong** — Puts a number on event volume (hundreds of engineers × sessions/day
  × events/session) and on prompt-event size, and uses those numbers to justify a
  design choice — e.g., why local buffering and batched upload beats a live
  streaming connection at this volume, or what write throughput the backend needs
  to sustain.
- **Adequate** — Gestures at "a lot of engineers, a lot of events" without a
  number feeding a decision.
- **Thin** — No estimation attempted anywhere in the design.
- **Common miss:** never estimating how much raw prompt/tool-use data hundreds of
  engineers generate per day — this number is what makes "ship everything live"
  versus "buffer and batch" a real tradeoff instead of an arbitrary choice.

## 3. API surface

- **Strong** — Defines the local collection interface (what the CLI hooks or the
  AI-assistant hook actually write, and where — a local file, a local queue) as
  separate from the upload/ingest API that ships batched events to the backend,
  and separate again from the query API the aggregate dashboard and per-session
  view read from. Says explicitly what the ingest API accepts (a batch of
  pre-redacted events) versus what it must reject (raw, unredacted content).
- **Adequate** — Describes an ingest endpoint and a query endpoint but doesn't
  address the local collection interface or where redaction sits relative to it.
- **Thin** — Describes only "events go to a database" with no interface boundary
  named anywhere.
- **Common miss:** not defining an explicit contract for what a batch upload is
  allowed to contain — without that contract, "redaction happens somewhere" isn't
  actually enforced anywhere.

## 4. Data model

- **Strong** — Defines a schema that ties disjoint raw events (dev-server
  start/stop, cache hit/miss, assistant tool-call, prompt-shipped) to a session
  identifier and a machine/engineer identifier, with enough of a time dimension
  (ordered timestamps or sequence cursors) to stitch them into a per-session
  timeline after the fact. Names how incremental reads are tracked without
  duplication — e.g., a byte-offset or sequence cursor per source file, advanced
  only after a successful upload.
- **Adequate** — Has a session concept and event types but is vague on how
  incremental/offline collection avoids re-sending or dropping events across a
  process restart.
- **Thin** — "We store events in a table" with no session-stitching concept and
  no answer for incremental collection.
- **Common miss:** designing the schema around a single event stream instead of
  multiple independent local sources that need a shared session key and
  independently tracked read cursors to merge correctly.

## 5. Scale path

- **Strong** — Addresses how per-session timeline reconstruction stays fast as
  event volume grows — e.g., window functions or a similar join strategy over
  time-ordered events per session, and why that holds up across hundreds of
  engineers' concurrent sessions. Addresses where signal-derivation computation
  runs (batch job vs. on-read) and how that choice scales independently of raw
  ingest volume.
- **Adequate** — Says the backend "can scale" without naming a specific query or
  computation pattern that would need to change as volume grows.
- **Thin** — No discussion of what breaks or slows down as engineer count or
  event volume grows.
- **Common miss:** designing per-session reconstruction as an on-the-fly query
  that's fine at low volume, without noticing it degrades badly once thousands of
  sessions/day accumulate and the aggregate view needs to scan across all of them.

## 6. Failure modes

- **Strong** — Explicitly covers offline collection: what happens to events
  generated while the machine has no network path to the backend, how long
  they're buffered locally, and what happens if local storage fills up or the
  collecting process crashes mid-buffer. Covers partial/duplicate delivery: what
  happens if a batch is uploaded but the client never receives acknowledgment —
  does a retry double-count, and how is that prevented.
- **Adequate** — Mentions offline buffering exists but doesn't address crash
  recovery or retry/duplication.
- **Thin** — Assumes the collecting agent is always online and events always
  arrive exactly once.
- **Common miss:** not addressing what happens when the local buffer itself is
  lost (disk full, process killed before flush) — silent data loss here directly
  undermines the aggregate metrics leadership is relying on.

## 7. Tradeoffs

- **Strong** — Names a real alternative to client-side redaction (e.g.,
  server-side redaction after ingest, or no redaction with strict access control
  instead) and gives a specific reason it was rejected — usually that
  server-side redaction means unredacted content crossed the network and touched
  a server disk at least once, which is the exact trust property the design is
  supposed to prevent. Discusses the granularity tradeoff in signal detection:
  more sensitive crash-loop/friction detection catches more real problems but
  also raises more false positives that erode trust in the system's output.
- **Adequate** — Names an alternative without connecting the rejection reason back
  to the trust requirement specifically.
- **Thin** — Presents one design with no alternative considered, or discusses
  tradeoffs unrelated to privacy/trust at all.
- **Common miss:** proposing server-side redaction or a "trusted internal team
  reviews raw data" carve-out without recognizing that both keep the sensitive
  content in a place the engineer has to trust someone else about, not the
  system itself.

## 8. Lived detail

This is a system the candidate actually built from zero. A technically-correct
but generic answer is a **weak** answer here — the interviewer is checking
whether he actually shipped this, not whether he can reason about it from first
principles.

- **Strong** — Names the specific collection layers actually built (dev-server
  telemetry, AI-assistant tool-use hooks, prompt shipping with an incremental
  cursor mechanism) and the concrete stack choices (what served the API, what
  stored the data, what technique stitched timelines together). States a specific
  number of redaction patterns applied client-side and why that number is what it
  is — what categories of content they cover. Describes a specific decision the
  data caused — a real example of a process or tooling change the org made
  because of what this system showed, not a hypothetical one.
- **Adequate** — References "a redaction layer" and "some patterns" and "it
  changed a decision" without naming the specific decision, the specific
  technique, or a number.
- **Thin** — The design is technically sound but reads identically to how it
  would if the candidate had never built this — no named stack choice, no
  concrete redaction count, no real decision it caused.
- **Absent** — No lived detail offered at all; scores purely on architectural
  reasoning.
- **Common miss:** describing signal detection (crash loops, friction windows,
  cold caches) only in the abstract instead of naming what was actually derived
  and what it actually revealed the org hadn't known before — the first real data
  point the org got on dev-server startup patterns or cache hit rates is the kind
  of detail that proves this was really built, not designed on a whiteboard.
