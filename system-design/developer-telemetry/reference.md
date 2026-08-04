# Reference: Developer Experience Telemetry Platform

A worked design. Spoiler — read deliberately, not while attempting the drill.

## The shape of the answer

**Three collection layers, kept architecturally separate because their
sensitivity differs.** Dev-server and build telemetry (startup time, cache
hit/miss, restart events) is low-sensitivity operational data. AI-assistant
tool-use events (which tool was invoked, when, success/failure) are medium —
they reveal workflow shape but not content. Prompt content is high-sensitivity —
it can contain pasted code, file contents, or anything the engineer typed,
including things they didn't mean to have logged verbatim. Treating these as one
undifferentiated event stream is the first mistake; the redaction and trust
story only works if the pipeline knows which category an event belongs to from
the moment it's written.

**Everything is written locally first, never streamed live.** Each collection
source (dev-server hook, build-tool hook, AI-assistant hook) appends to a local
file or local queue on the engineer's machine. Nothing crosses the network as it
happens. This is the mechanical answer to "what does local-first mean": there is
no live connection reporting a keystroke or a build event in real time to
anything, which is also the first concrete thing you can show a skeptical
engineer — there's no socket open to a server while they work.

**Prompt content gets redacted client-side, before it ever leaves the machine.**
A set of redaction patterns (roughly a dozen: things like API keys, emails,
tokens matching common secret formats, absolute paths that might leak
usernames, and similar identifiable-content patterns) runs on the local machine
against prompt text before it's written to the upload queue. The unredacted
version is never transmitted, never touches a server disk, and isn't
recoverable server-side even by someone with backend access — which is the
difference between "we promise not to look" and "there is nothing sensitive to
look at." This placement (client-side, pre-transmission) is the single decision
that does the most work for the trust problem: it means the trust boundary is a
verifiable property of the code running on the engineer's own machine, not a
policy enforced downstream where the engineer can't check it.

**Incremental, offline-tolerant collection via cursors, not a live stream.** Each
local event source is a file the collector reads from a tracked byte offset. On
each upload cycle, the collector reads new bytes since its last successful
upload, ships them, and only then advances the cursor. If the machine is
offline, the file keeps growing and the cursor doesn't move — nothing is lost,
and on reconnect the collector catches up from where it left off. If the process
crashes mid-cycle before the cursor advances, the same bytes get re-read and
re-uploaded on restart — so the ingest side needs idempotent writes (a stable
event ID derived from source + offset range) to avoid double-counting on retry,
rather than relying on exactly-once delivery that doesn't really exist here.

**Backend: an API in front of a Postgres-backed store, with timelines stitched
at read time via window functions and lateral joins.** Every event carries a
session identifier and a timestamp. A session's timeline is reconstructed by
ordering all events sharing that session key and using window functions to
compute derived fields — gaps between consecutive events, running duration,
sequence position — rather than materializing a separate timeline table that has
to be kept in sync. Lateral joins pull in the nearest related event from a
different source (e.g., "what build event was in progress when this AI tool call
happened") without a full cross join across all events.

**Signal detection runs as derived computation over the raw event stream, not as
a separate collection concern.** A crash loop is "N restart events for the same
session within a short window" — a query pattern over the raw events, not a
distinct thing collected at the source. A friction window is a gap between
events longer than some threshold with no corresponding "waiting on user"
signal. A slow startup or cold cache is a threshold on a dev-server timing field
already being collected. Keeping these as derived views over raw events (rather
than special-cased at collection time) means new signals can be added later
without touching the collection layer at all — a data-model property, not just a
convenience.

**Prompt summarization runs after collection, on the backend, using a cheap
model.** Raw prompts (already redacted client-side) are summarized via an
inexpensive model call so the aggregate view can show "what kinds of things are
engineers asking the assistant" without a human — or even the aggregate
dashboard itself — needing to read raw prompt text. This is a second layer of
distance between "what was collected" and "what a person looking at a dashboard
actually sees."

## Telling it as a deep-dive story

**The incident/gap.** The org had zero data on how engineers actually
experienced local development — dev-server startup time, whether the build
cache was actually being hit, how AI tooling was actually being used day to day.
Every conversation about tooling investment was anecdote-driven.

**The constraint.** Anything that looks like it's watching engineers work kills
its own adoption — and worse, becomes something engineers route around,
poisoning the very data it's meant to produce. The system had to be trustworthy
by construction: local-first collection, client-side redaction before anything
leaves the machine, and no path to per-engineer scoring even if someone later
wanted to build it.

**The decision that was contested.** Where redaction happens — client-side
before transmission, versus server-side after ingest with strict access
control — is a real fork. Server-side is operationally simpler and easier to
update (ship a new pattern without redeploying every engineer's local hook), but
it means unredacted prompt content crosses the network and touches a server disk
at least once, which is exactly the property the design exists to avoid. The
harder, client-side-first path was chosen because the trust story only survives
if it's a mechanical fact of the architecture, not a policy about what the
backend chooses not to look at.

**The measured outcome.** The platform produced the org's first real data on
dev-server startup patterns and turbo cache hit rates — numbers that previously
didn't exist anywhere. That data directly led to removing a pre-push hook that
was blocking pushes for over two minutes: a friction point that had become
invisible because engineers had stopped complaining about it, and that only
showed up because the system measured it instead of waiting for someone to
notice.
