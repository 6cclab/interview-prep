# Design: Developer Experience Telemetry Platform

Design a system that measures how engineers actually work inside a large monorepo:
local dev-server performance, build and cache behavior, and how they're using
AI coding assistants — without making anyone feel surveilled.

Leadership wants data instead of anecdotes to answer questions like: how long does
it actually take engineers to get a working dev server running, is the build cache
actually being hit, and where are engineers losing time to friction they've stopped
noticing because it's become normal. Right now the org has none of this — decisions
about tooling investment are made on complaints and gut feel.

## Requirements

- Collection happens on each engineer's own machine, primarily from CLI tools
  (dev server, build tool) and from hooks into an AI coding assistant they use
  locally.
- Engineers must be able to trust this. It is measuring their machine and their
  workflow, and the moment it looks like a surveillance tool, adoption collapses
  and the data becomes worthless (or worse, actively resisted). Design the system
  so that trust is a property of the architecture, not a promise in a doc nobody
  reads.
- Some of what's collected is inherently sensitive: prompts typed into an AI
  assistant may contain code, file paths, or pasted content the engineer didn't
  intend to have logged as-is. The system needs an answer to what leaves the
  laptop and in what form, before any of it reaches a shared backend.
- Engineers are not always online or always willing to have a live connection
  reporting in real time. The collection layer must work when offline and catch up
  later without duplicating data or losing it.
- The output needs to support two different consumption modes: an aggregate,
  organization-wide view (e.g., "cold cache rate has been trending up for a
  month") and a per-session reconstruction detailed enough to diagnose a specific
  bad experience (e.g., "this session had a five-minute stall — what was
  happening").
- The system should be able to detect and surface specific behavioral patterns —
  e.g., repeated crash-and-restart cycles, a slow startup, a session stuck without
  progress — not just raw counters.
- Someone should eventually be able to point at a decision the org made — a tool
  change, a process change — and trace it back to data this system produced.

## Scale to design for

- A large monorepo, hundreds of engineers, most running the dev server and build
  tooling multiple times a day.
- Multiple independent event sources per engineer machine, all needing to be
  stitched into a coherent per-session picture after the fact.

## What the interviewer wants covered

- What "local-first" collection actually means mechanically: where events are
  buffered before they leave the machine, and how the system behaves when the
  machine is offline for an extended period.
- How you avoid double-counting or losing events when a buffered batch is read and
  shipped incrementally, potentially across restarts of the collecting process.
- Where redaction happens — client-side before transmission, or server-side after
  — and why that placement matters for the trust problem, not just the technical
  one.
- What earns engineer trust here, concretely — not "we'll be transparent," but a
  specific architectural or process choice that makes surveillance impossible or
  visibly checkable, and what you'd say to an engineer who's skeptical.
- The data model for stitching disjoint raw events (dev-server start/stop, build
  cache hits, assistant tool calls) from one machine and one working session into
  a single reconstructable timeline.
- How you go from raw events to a named behavioral signal (e.g., "crash loop") —
  what that computation looks like and where it runs.
- How this system's output would actually change a decision, and how you'd know it
  did.

## Out of scope (say so, don't design it)

- The AI assistant itself, or the dev server/build tool internals — you're
  instrumenting them, not building them.
- Individual performance reviews or any per-engineer scoring — assume the org has
  ruled this out as a use case; if your design would make that easy to build
  anyway, say so, because that's a trust problem even if it's never turned on.
