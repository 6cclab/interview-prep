# Multi-Engine File Scanning Service

Design a service where users submit files and get back a verdict on whether each
file is malicious, produced by running the file through many independent scanning
engines and aggregating what they say.

## Scope

A user uploads a file. The system stores it, runs it through every scanning
engine it knows about, aggregates the results, and returns a verdict. Users can
later look up any file by its hash and see the current verdict without
re-uploading.

Cover:

- **Upload and storage** — files range from a few KB to several hundred MB. The
  same file is submitted over and over by different users; storing and scanning
  each copy independently is not affordable.
- **Identity** — what identifies a file, and what the API looks like when a
  client wants to know whether you already have one before spending bandwidth
  sending it.
- **Scan fan-out** — a submission must reach N independent engines. Engines are
  heterogeneous: some return in milliseconds, some take minutes, some are
  third-party services that rate-limit you, some crash on malformed input.
  Define what a caller sees while this is in flight.
- **Aggregation** — engines disagree. Define what a verdict is, given 60
  opinions of varying quality, and what the API returns when 55 have reported
  and 5 have not.
- **Verdicts change without the file changing.** An engine ships new signatures
  and a file that was clean last week is malicious today. Design for that
  explicitly: it is the part of this problem that separates a real design from a
  plausible one.
- **Storage and sharding** — verdict and metadata storage keyed by file
  identity, at a scale where one database will not hold it.
- **Tenancy and privacy** — see the constraint below. This is the sharpest
  trade-off in the problem.
- **Hostile input** — the files are, by construction, sometimes actual malware.
  Say what that changes about how and where they are executed and stored.

## The constraint that makes this interesting

**Deduplication and privacy pull in opposite directions, and you must resolve it
explicitly.**

Deduplicating by content is what makes the economics work: one physical copy, one
scan, results shared by everyone who submits that file. But some submissions are
private — a customer uploading an internal build does not accept that a
competitor can now confirm that exact binary exists in your system by uploading a
copy and observing a fast "already known" response.

A design that dedupes without addressing this has leaked information. A design
that never dedupes has thrown away the thing that makes it affordable. Say which
you are doing, for which class of submission, and what the observable difference
is to a client trying to probe you.

## Scale to design for

- 2 million file submissions per day, growing 3x year over year.
- **~85% of submissions are files already seen before.** Design accordingly.
- Median file 300 KB; p99 40 MB; hard cap 650 MB.
- 60 scanning engines. p50 engine latency 400 ms, p99 90 seconds, and 3 engines
  are external services capped at 25 requests/second each.
- Hash lookups (`is this file known, and what is its verdict`) run at roughly
  200x the rate of uploads — this is the dominant read path by a wide margin.
- Total corpus after 3 years: on the order of 2 billion distinct files.
- Engine signature updates land continuously; a large vendor update can
  invalidate prior verdicts for millions of files at once.

## Non-goals (state your own, but at minimum)

- You are not designing the scanning engines. Assume each is a black box that
  takes bytes and returns a verdict plus a confidence.
- You are not designing malware detection logic or writing signatures.
- You do not need to design the web UI.

## What the interviewer wants covered

A staff-level answer picks a content-addressing scheme and says which hash and
why, including what it does about collisions and about clients that supply a
hash they did not compute honestly. It has a real answer for the re-scan problem
— not "we re-scan periodically" but a design that says what gets re-queued when
a vendor updates, in what order, and how that backfill avoids starving live
traffic. It treats the 85% dedup rate as a load-bearing number rather than
trivia, and it resolves the privacy tension above out loud instead of hoping
nobody asks.

Bring your own numbers. Storage growth, scan-worker count, and queue depth under
a vendor-wide invalidation are all derivable from what is given, and an answer
that states none of them has a gap an interviewer will find.
