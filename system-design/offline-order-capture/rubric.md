# Rubric: Offline Order Capture (Restaurant POS)

Score each dimension **strong / adequate / thin / absent**. One sentence of
evidence per rating, quoting the attempt's own words. No score without a
quote.

Calibration note: this maps closely to a design question reported from a
real interview ("design an API related to managing a restaurant").
Grade concreteness hard — checks, items, modifiers, seats, tenders should
appear by name, not as generic "records" or "objects." An answer that never
touches payment capture under partial connectivity is not a passing answer
for this prompt regardless of how good the sync design is, since that's the
one piece of this domain that can't be waved away with a CRDT.

---

## 1. Requirements clarification

- **Strong**: distinguishes what must work with zero connectivity (add/edit
  items on a check, fire to a *local* kitchen printer/KDS, apply a cash
  tender, view the current state of checks on the LAN) from what genuinely
  requires connectivity (card authorization against an external processor,
  cross-location reporting, menu sync from the cloud) before designing
  anything; states an explicit assumption about terminal-to-terminal
  connectivity (LAN survives even when WAN doesn't) since that changes the
  whole design.
- **Adequate**: says "some things work offline, some don't" but doesn't
  enumerate which.
- **Thin**: starts describing sync architecture before stating what needs to
  survive an outage.
- **Absent**: no scoping.
- **Common miss**: not stating the LAN-survives-WAN-drops assumption
  explicitly — this single assumption is what makes local multi-terminal
  consistency solvable at all; without it, the design either silently assumes
  single-terminal restaurants or silently assumes a LAN it never justified.

## 2. Back-of-envelope estimation

- **Strong**: derives check-mutation rate from the given numbers (e.g. 100
  tables turning ~2x during a 3-hour dinner rush ≈ 200 checks, each with ~15
  mutations — item added, fired, modified, paid — ≈ 3,000 mutations over 3
  hours ≈ under 1/sec per restaurant, bursty around ordering windows) and
  uses it to argue the per-restaurant write volume is small enough that local
  storage and LAN sync are not a throughput problem — the design challenge is
  correctness under partition, not scale. Also estimates local storage needed
  to buffer a full outage (a day's worth of checks is at most a few MB of
  structured data) to justify that on-device storage is not a constraint.
- **Adequate**: gives a rough per-restaurant order volume but doesn't use it
  to justify anything about local storage or sync design.
- **Thin**: a bare "not that much data" with no numbers.
- **Absent**: no estimation at all.
- **Common miss**: estimating fleet-wide numbers (tens of thousands of
  restaurants) and treating that as the throughput problem for *this*
  design — the fleet scale matters for the cloud/reporting side, but the
  offline-capture problem is bounded by one restaurant at a time, and
  conflating the two leads to over-engineering the local write path.

## 3. API surface

- **Strong**: defines terminal-local operations as discrete, named commands
  with idempotency keys — e.g. `openCheck(checkId, table)`,
  `addItem(checkId, itemId, opId)`, `voidItem(checkId, itemLineId, opId)`,
  `fireCourse(checkId, courseId, opId)`, `applyTender(checkId, tenderId,
  amount, opId)`, `closeCheck(checkId, opId)` — each carrying a client-generated
  operation ID so a retried request after a dropped response is a no-op, not
  a duplicate. Separately defines the sync/replication surface between
  terminals and between a terminal and the cloud (e.g. "push my operation log
  since sequence N, receive theirs") as distinct from the order-taking API.
- **Adequate**: defines CRUD-ish endpoints for checks/items but no
  idempotency key or operation identity, so a retry is indistinguishable from
  a new mutation.
- **Thin**: describes the API only in prose ("terminals can add items to a
  check") with no concrete shape.
- **Absent**: no API described.
- **Common miss**: omitting an idempotency key from the mutating operations —
  this is the single most common gap on this problem, and it's the exact
  thing that turns "terminal retries a request it wasn't sure went through"
  into a double-fired item or a double charge.

## 4. Data model

- **Strong**: models a check as a header (table, guest count, status, opened-at)
  plus an ordered log of operations (append-only: item added, modifier
  applied, seat assignment, item voided, tender applied, check closed) rather
  than a single mutable row — and explains that the operation log, not a
  snapshot, is what each terminal replicates and replays, because logs merge
  more predictably than whole-row overwrites. States where each piece lives:
  operation log and current-state projection stored locally per terminal (or
  per restaurant, on a local server/hub) in an embedded or lightweight local
  store, replicated to the cloud once connectivity returns, with the cloud
  copy being the durable system of record for reporting once synced. Names
  seats and modifiers as attributes on line items, not as separate
  unconnected entities.
- **Adequate**: models checks and items as normal mutable rows/entities with a
  local database, without the operation-log framing, and doesn't explain how
  two terminals' concurrent edits to the same row get reconciled.
- **Thin**: "store the check in a local database" with no structure for
  items, modifiers, seats, or tenders.
- **Absent**: no data model.
- **Common miss**: modeling the check as a single mutable document/row that
  both terminals overwrite, which makes the reconciliation question
  unanswerable except by picking a loser — an operation-log model is what
  makes commutative merge possible at all, and skipping it usually shows up
  later as a hand-wave in the failure-modes section.

## 5. Scale path

- **Strong**: identifies that this system does *not* scale like a typical
  high-QPS service — each restaurant is an isolated unit with low absolute
  volume — and instead frames "scale" correctly as restaurant *count* (tens
  of thousands of independent, mostly-uncoupled instances) rather than
  per-restaurant throughput; discusses what changes when a single large
  restaurant has many terminals and high table turnover (more concurrent
  editors of the same check → more frequent merge conflicts, not more raw
  throughput) and what changes when the chain adds locations (cloud-side
  ingestion/reporting fan-in, not the terminal design).
- **Adequate**: says the system scales because each restaurant is independent
  but doesn't discuss what changes as terminal count per restaurant grows.
- **Thin**: applies generic "add more servers" scaling language that doesn't
  fit this problem's actual shape.
- **Absent**: no scale discussion.
- **Common miss**: reflexively reaching for a distributed-systems scaling
  story (sharding, load balancers) when the real scale axis here is number of
  independent tenants, and per-tenant volume is small enough that most
  general-purpose scaling techniques are irrelevant.

## 6. Failure modes

- **Strong**: this is the load-bearing dimension for this prompt. A strong
  answer must explicitly address, by name:
  - **The same check edited on two terminals during a partition** — what
    happens when they reconnect. A strong answer distinguishes *which*
    operations merge safely and which don't (see dimension 7) rather than
    proposing one blanket resolution strategy for all edits.
  - **Card authorization while offline** — explicit acknowledgment that a
    card cannot be authorized without reaching the processor, and an explicit
    decision: either (a) store-and-forward the charge and accept the risk of
    later decline/insufficient-funds discovered after the guest has left, with
    a stated mitigation (e.g. cap store-and-forward amount, flag for
    manual follow-up), or (b) degrade to cash-only / manager-override /
    IOU-and-follow-up-later when offline, accepting the operational cost.
    Either is acceptable; *not choosing* is not.
  - **A terminal that never reconnects until end of shift** vs. **one that
    drops for eight seconds** — different recovery paths, not the same code
    path at different time scales.
  - **The local network/hub itself failing** (if the design routes through a
    local server) — does each terminal fall back to being fully independent,
    or does ordering stop?
- **Adequate**: covers 2-3 of the above concretely, or covers all of them but
  only in general terms ("terminals sync when they reconnect").
- **Thin**: gestures at "the app works offline" without a specific failure
  scenario.
- **Absent**: no failure modes.
- **Common miss**: treating payment as just another field to sync, rather
  than as the one operation that cannot be made safe by a clever merge
  strategy because it depends on an external, un-fakeable authority (the
  card network). Also common: proposing a single resolution strategy (e.g.
  "last write wins") for all check edits without noticing it's wrong for
  some of them.

## 7. Tradeoffs

- **Strong**: explicitly separates operations that are **safely commutative**
  under concurrent, out-of-order application — adding an item, applying a
  modifier, assigning a seat, voiding a specific item — from operations that
  are **not commutative and need ordering or single-writer semantics** —
  applying a percentage discount to the whole check (order relative to what
  items exist matters), closing/paying a check (must happen exactly once,
  after all pending items are known), reopening a closed check. States the
  mechanism for the non-commutative case specifically (e.g. a check has a
  single "owning" terminal for close/payment, or closing requires a
  confirmed round-trip once connectivity exists, rather than being
  offline-safe at all) rather than applying the same conflict-free story to
  everything. Also states the payment store-and-forward-vs-degrade tradeoff
  from dimension 6 as a tradeoff with a named alternative and reason, not
  just a fact stated once.
- **Adequate**: mentions that some operations are safer to merge than others
  but doesn't name which specific operations fall on which side.
- **Thin**: one merge strategy proposed for all edits, no alternative
  discussed.
- **Absent**: no tradeoffs section.
- **Common miss**: reaching for "everything is a CRDT" or "everything is
  last-write-wins" as a single uniform answer — both are wrong as a blanket
  policy, and the tell that someone hasn't thought about *this* domain
  specifically is a design that never distinguishes commutative item-level
  edits from check-level financial operations like discounting and closing.
