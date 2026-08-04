# Reference: Feature-Flag Delivery for an Engineering Org

A worked design. Spoiler — read deliberately, not while attempting the drill.

## The shape of the answer

**Split the problem by consumer type first.** Server-side services are long-lived
processes: they can hold a full local cache of flag definitions and targeting
rules in memory and evaluate flags locally, with zero network call in the hot
path. Client-side consumers (browser, mobile) are short-lived, untrusted, and
can't be handed the org's full targeting-rule payload — sending every rule to
every browser leaks internal segmentation logic and is a lot of dead weight for
a session that only needs the flags relevant to it.

**Put a proxy layer between the vendor and both populations.** The proxy holds a
streamed connection to the vendor (not polling — polling at this service count
multiplies vendor load linearly with consumers and adds propagation latency
equal to the poll interval; streaming pushes changes once to the proxy, which
then fans out). Server-side SDKs stream from the proxy instead of the vendor
directly. Client-side SDKs get a reduced, pre-evaluated payload from the proxy —
either flags relevant to that user's context, or an evaluated bootstrap payload —
never the full rule set.

**Persist the proxy's cache outside its own process.** An in-memory-only cache
means a proxy restart loses last-known-good state and starts cold at the worst
possible moment — right after a deploy, which is also often close in time to
whatever caused the vendor problem. Back the cache with a durable store the proxy
can read on startup, so a fresh proxy instance has *something* to serve
immediately instead of blocking on the vendor.

**Define "correct during an outage" per flag, not globally.** Three options:
serve last-known-good, serve a configured default, or fail closed (treat as off).
Last-known-good is the right default for most flags — a flag that was "on" ten
minutes ago is still probably meant to be "on." But some flags — a kill switch
for a broken feature, say — need an explicit override that isn't "whatever it was
last," because "last known" might be the exact state you're trying to escape.
This has to be a per-flag decision made by whoever owns the flag, not a system
default that gets silently applied everywhere.

**Cold start:** a process — server or proxy — that has never successfully synced
has no last-known-good value at all. The bootstrap answer is a baked-in default
payload shipped with the deploy (not fetched at runtime), so a brand-new instance
serves *something* sane before its first successful sync, rather than either
blocking startup on the vendor or serving undefined behavior.

**Multi-region:** run a proxy per region rather than one global instance, so a
regional network partition to the vendor doesn't take down evaluation in regions
that still have connectivity. This costs eventual consistency — a flag flip can
land in one region's proxy before another's — which is the right tradeoff against
the alternative of a single global proxy becoming a cross-region latency and
failure dependency for every request everywhere.

**The obvious counter-question: doesn't the proxy just become a new single point
of failure?** Yes, partially — which is why it's not a single instance. Run it as
a horizontally scaled, load-balanced tier per region, each instance capable of
serving from its own persisted cache independently, so no single proxy instance
dying takes evaluation down. The honest answer to "what if the whole proxy tier
is down" is that SDKs fall back further — to their own last locally-cached
values, held client-side even in the server SDK — so there are two layers of
last-known-good, not one: proxy-level and SDK-level.

## Telling it as a deep-dive story

**The incident.** A SaaS flag vendor had an outage. Every service evaluating
flags either served stale data with no clear policy behind it, or blocked and
timed out waiting on a vendor that wasn't coming back soon — because nobody had
decided in advance, per flag, what "vendor is down" should mean.

**The constraint.** The fix had to cover the org's flag consumers without
touching how application code calls the SDK — teams could not be asked to
rewrite their `isEnabled()` call sites, and the fix had to work for both
long-running backend services and short-lived client sessions, which have very
different trust and payload constraints.

**The decision that was contested.** Introducing a proxy tier is itself a new
component with its own failure mode — the exact counter-question above. That
tradeoff had to be defended to directors and SRE leadership: is the proxy's own
availability, deployed and operated in-house, actually more trustworthy than the
vendor's, or is this just moving the single point of failure one hop closer to
home? The resolution: yes, conditionally — because an in-house component can be
run redundantly per region with a persisted cache and full observability, none
of which the org controls for the vendor's own infrastructure. That argument, not
just the architecture, is what got it approved.

**The measured outcome.** Coverage across the org's services (split between
server-side and client-side consumers), with the system observable enough
(metrics and traces) to show it was actually serving correctly during the
following vendor incident, instead of everyone finding out from user reports.
