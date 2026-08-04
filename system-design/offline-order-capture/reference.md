# Reference Design: Offline Order Capture (Restaurant POS)

This is a worked design, not the only correct one. Read it after your own
attempt, not before.

## 1. Requirements

**Functional**: terminals in a restaurant open checks, add/void/modify line
items (with modifiers and seat assignments), fire items to the kitchen,
apply tenders (cash, card, gift card, split across multiple payers or
multiple checks), and close checks. Multiple terminals in the same
restaurant see a consistent view of open checks.

**What must work with zero connectivity to anything outside the
restaurant**: open a check, add/void/modify items, apply modifiers, assign
seats, fire to a *local* kitchen printer or KDS, apply a cash tender, view
current state of all open checks from any terminal on the LAN.

**What genuinely requires external connectivity**: authorizing a card
(needs the processor), any cross-location reporting or menu update push
from the cloud. This is the one hard boundary in the whole design — no
local cleverness makes card authorization possible without reaching the
processor, and pretending otherwise is the most common failure of a design
attempt on this problem.

**Assumption stated up front**: the restaurant's LAN keeps working even
when its WAN (internet) connection drops — this is realistic (a WAN outage
is an ISP/router-uplink problem, not a Wi-Fi/switch problem) and it's the
assumption that makes "multiple terminals in one restaurant stay
consistent during an outage" solvable at all. If the LAN itself is assumed
down too, every terminal degrades to single-terminal mode, which is a
smaller, easier version of the same design.

**Non-goals**: multi-location reporting, kitchen display UI, menu/pricing
management (menu is assumed already synced and read-only for this design).

## 2. Estimation

**Per-restaurant mutation volume.** ~100 tables turning over ~2x during a
3-hour dinner rush ≈ 200 checks opened. Each check accumulates roughly
15 operations over its life (open, several item-adds, a modifier or two, a
fire, maybe a void, a tender, a close) ≈ **3,000 operations over a 3-hour
window**, well under 1/sec sustained, bursty around the top of each seating
turn (everyone orders in the first 10 minutes of being seated). This is a
low-throughput problem — the design challenge here is correctness under
partition, not raw write capacity, and a local store on commodity terminal
hardware handles this volume trivially.

**Local storage for a full outage.** A day's worth of a restaurant's checks
— say 500 checks, each a few hundred bytes of header plus a dozen ~100-byte
operation-log entries — is on the order of a few hundred KB to low single-
digit MB. A terminal can buffer *weeks* of outage locally without any
storage-capacity concern; the constraint on offline duration is operational
(a restaurant that's offline for a week has bigger problems) not technical.

**Fleet-wide scale** (tens of thousands of locations) matters for the
cloud-side ingestion and reporting pipeline, not for the terminal design —
each restaurant's write volume is independent of every other restaurant's,
so this doesn't compound the way it would in a shared-throughput system. Worth
stating explicitly so the design doesn't over-engineer the per-restaurant
write path to handle a scale axis that doesn't actually apply to it.

## 3. API surface

Two distinct surfaces: an **order-taking API** (terminal-to-terminal,
LAN-local) and a **sync API** (terminal/restaurant-to-cloud).

**Order-taking, as discrete idempotent commands**, each carrying a
client-generated `opId` (UUID) so a retried call after a dropped response is
a no-op rather than a duplicate:

```
openCheck(checkId, tableId, opId)
addItem(checkId, lineItemId, menuItemId, seatNumber, opId)
addModifier(checkId, lineItemId, modifierId, opId)
voidItem(checkId, lineItemId, reason, opId)
reassignSeat(checkId, lineItemId, newSeatNumber, opId)
fireCourse(checkId, courseId, opId)
applyTender(checkId, tenderId, type[cash|card|gift], amount, opId)
applyDiscount(checkId, discountId, amount|percent, opId)
closeCheck(checkId, opId)
```

Each call is appended, locally, as an entry in that check's operation log
(see data model) and broadcast to other terminals on the LAN (a lightweight
local pub/sub — any terminal that's up hears every operation as it happens).
A terminal that was offline for the broadcast catches up by requesting the
tail of each check's log it's missing once it reconnects to the LAN — same
mechanism, replayed.

**Sync API (restaurant → cloud)**: once WAN connectivity exists,

```
POST /v1/restaurants/{id}/sync
{ sinceSequence: N, operations: [...] }
-> { ackedThrough: M, conflicts: [...] }
```

The restaurant (via whichever terminal or local hub currently has WAN
reach) pushes its operation log tail to the cloud, which is the eventual
system of record for reporting; the cloud never originates order-mutating
operations itself for the current shift, so it has nothing to conflict with
except operations from other terminals it hasn't seen yet — resolved the
same way terminal-to-terminal conflicts are (section 6/7).

**Backpressure/overload note**: because per-restaurant volume is tiny
(estimation above), overload of the sync path is a non-issue at the single-
restaurant scale; at fleet scale the cloud ingestion endpoint applies
ordinary per-tenant rate limiting, but a restaurant is never blocked from
taking orders by cloud-side pressure — the sync push is fire-and-retry from
the restaurant's side, not synchronous with order-taking.

## 4. Data model

**A check is an operation log, not a mutable row.** Each check has:

```
Check {
  checkId, tableId, status[open|closed|voided], openedAt,
  operations: [ { opId, type, payload, terminalId, localSeq, timestamp } ]
}
```

Current state (the list of items, their modifiers, seat assignments, total
owed) is a **projection** — derived by replaying the operation log in
order, not stored as the primary representation. Line items, modifiers, and
seat assignments are all just operation types (`addItem`, `addModifier`,
`reassignSeat`) applied against the check, so an item's modifiers and seat
are attributes carried on the `addItem`/`addModifier` operations, not
separate top-level entities disconnected from the check.

**Why a log instead of a mutable document**: two terminals that each apply
an operation offline, then reconnect, can *merge two logs* (interleave by
timestamp/terminal-priority, replay) far more predictably than they can
merge two independently-mutated snapshots of "the current item list" — a
snapshot merge has no record of what each side actually *did*, only where
each side *ended up*, and that's not enough information to resolve a
conflict correctly (see section 7 for which operations merge safely).

**Storage per terminal**: an embedded local store (SQLite-shaped — durable,
transactional, zero ops burden on hardware that isn't always network-
connected) holding the operation log and the current projection for every
check currently open or recently closed at that restaurant. Every terminal
on the LAN eventually holds a full copy of the restaurant's current
checks (broadcast-and-replay, section 3) — there is no single terminal that
is a single point of failure for reading check state.

**Cloud storage**: once synced, operations are durable in a
restaurant-partitioned store (partition key = restaurant ID, since checks
never cross restaurants) — this is the system of record for anything past
the current shift: reporting, historical lookups, dispute resolution. The
cloud store is not on the critical path for taking an order.

**Tenders**: `applyTender` operations reference a `tenderId` and carry an
amount and type; a check can have multiple tender operations (split
payment) and the projection sums them against the check total to determine
when the check is fully paid. A card tender additionally carries an
authorization state (`pending|authorized|declined|queued-offline`) — see
section 6 for what that state machine looks like when offline.

## 5. Scale path

This system does not scale the way a typical high-QPS service does. The
scale axis is **restaurant count** (tens of thousands, each independent),
not per-restaurant throughput, which stays small regardless of chain size
(estimation, section 2).

**What changes as one restaurant gets bigger** (more terminals, higher
table turnover): more concurrent editors of the same check, which raises
the *rate of concurrent edits to the same check*, not the raw operation
count — this is a merge-conflict-frequency problem, not a throughput
problem, and is addressed by making the common concurrent edits (adding
items) commutative by design (section 7) so higher concurrency doesn't
translate into more actual conflicts to resolve.

**What changes as the chain adds locations**: purely a cloud-side
ingestion/reporting fan-in problem — more independent restaurant-partitioned
streams landing in the same store — which is an ordinary horizontally-
partitioned ingestion problem (partition by restaurant ID) and doesn't touch
the terminal design at all.

## 6. Failure modes

**Same check edited on two terminals during a partition.** Both terminals
keep appending to their local copy of the check's operation log while
unable to reach each other. On reconnect (LAN healed, or both back on WAN),
logs are merged by replaying all operations in a deterministic order
(timestamp, tie-broken by terminal ID) and reapplying. Whether this
produces a correct result depends entirely on whether the operations
involved are commutative — see section 7. For non-commutative operations
(discount, close), the merge doesn't silently pick a winner; the check
enters a `needs-reconciliation` state visible to staff/manager rather than
guessing.

**Card authorization while offline.** The processor cannot be reached, full
stop — no local cleverness authorizes a card. Chosen approach: **degrade,
don't fake it.** While offline, `applyTender(type=card)` is rejected by the
terminal with a clear message; staff is prompted to take cash, a gift card
(if its balance is verifiable locally via a synced/cached balance snapshot
with a conservative floor), or hold the check open and settle by card once
connectivity returns. Store-and-forward (accepting the card swipe offline
and authorizing it later) was considered and rejected as the default — see
tradeoffs — but the design supports it as a manager-enabled fallback with a
hard per-transaction cap, because some restaurants will accept the risk
rather than turn away a paying guest.

**Terminal offline for eight seconds vs. offline for the whole shift.**
Same mechanism, different visible consequence. A few seconds: the operation
broadcast to peers is simply delayed, peers catch up within a second of
reconnect, no staff-visible event. A whole shift: the terminal has a
potentially large backlog of operations to merge against everyone else's,
raising the odds of hitting a non-commutative conflict that needs staff
attention — the design surfaces "N checks need reconciliation" as a
worklist rather than blocking the terminal from being used again.

**Local network/hub failure** (if a per-restaurant local server/hub is used
to aggregate terminals rather than pure terminal-to-terminal broadcast):
each terminal falls back to being fully independent and still functions —
it keeps taking orders against its own local copy of state — but stops
seeing other terminals' updates until the hub or LAN recovers. This is why
terminal-to-terminal peer broadcast (not hub-mediated) is the preferred
default: it removes the hub as a single point of failure for the thing that
matters most (an individual terminal continuing to take orders).

## 7. Tradeoffs

**Which operations are commutative vs. which need ordering/single-writer
semantics — the central design decision of this problem.**

*Safely commutative* (merge automatically, any order, no staff
intervention): `addItem`, `addModifier`, `reassignSeat` (to an unoccupied
seat), `voidItem` (voiding a specific, already-identified item is
idempotent and order-independent — the item either ends up voided or it
doesn't). These are the overwhelming majority of operations during service,
which is why offline capture works at all for the common case.

*Not commutative — needs ordering or single-writer semantics*:
- `applyDiscount` — a percent discount computed before vs. after another
  terminal added three more items produces a different dollar amount; order
  matters.
- `closeCheck` / `applyTender` toward closing — must happen exactly once
  and only after all pending items on the check are known; closing a check
  on one terminal while another terminal is mid-add on the same check
  is exactly the double-fire/lost-item bug this design has to prevent.

**Resolution for the non-commutative set**: rather than trying to make
these conflict-free (rejected — a discount or a close is inherently
order-sensitive, no merge function makes it not so), the design gives each
check a **soft single-writer lease**: while a check is open, closing or
discounting it requires the terminal to hold a lease (acquired over the LAN
when connectivity exists; a terminal can still initiate but the operation
is queued as `pending-lease` if it can't confirm no one else holds it).
Under a full partition where lease confirmation isn't possible, the
terminal may still proceed (a restaurant must be able to close and pay out
a check even mid-outage) but the operation is flagged for reconciliation if
it turns out another terminal did something conflicting during the same
window. This trades a small, staff-visible reconciliation rate for never
blocking the terminal outright — rejected the alternative of *refusing* to
close a check while offline, because "can't cash out a table because the
internet is down" is an unacceptable business outcome for this product.

**Card payment: store-and-forward vs. degrade-when-offline.** Rejected
store-and-forward as the *default* because an authorization failure
(declined, insufficient funds) discovered after the guest has left is a
direct revenue loss with no recovery path, and the failure is silent to
staff at the moment it matters. Chose degrade-to-cash/gift-card/hold-and-
settle-later as the default, with store-and-forward available as an
explicit, capped, manager-opt-in fallback — because some restaurants
(higher average ticket, regular guests) will rationally prefer the risk of
occasional non-payment over the friction of ever refusing a card, and that
choice belongs to the business, not baked into the platform as the only
option.

**Operation log vs. mutable snapshot per check.** Already justified in the
data model (section 4); the log is what makes the commutative/non-
commutative split in this section possible to implement at all — a
snapshot-only design has no record of *what happened*, only where each side
ended up, so it can't even ask the question this section answers.

## What candidates typically get wrong

- **Treating all check edits the same way** — proposing one blanket
  strategy (usually "last write wins" or "just use a CRDT") for every field
  on a check, without noticing that adding an item and closing a check have
  completely different safety properties under concurrency. This is the
  single most common gap on this problem.
- **Pretending offline card authorization is solvable with cleverness.**
  It isn't. A design that doesn't explicitly say "the card cannot be
  authorized offline, and here's what we do instead" hasn't actually
  engaged with the hardest constraint in the prompt — it's tempting to
  treat payment as just another field to sync, and it isn't.
- **Modeling a check as a single mutable row/document.** Makes the merge
  question unanswerable except by picking a loser (usually implicitly
  "whoever syncs last wins"), which silently loses whichever terminal's
  edits arrived second — often the busiest terminal, which is the worst
  possible terminal to silently lose data from.
- **Sizing the design for fleet-wide scale instead of per-restaurant
  scale.** The interesting numbers here are small (a few thousand
  operations per restaurant per shift); a design that reaches for
  distributed-systems throughput techniques (sharding a single
  restaurant's writes, for instance) is solving a problem this domain
  doesn't have, at the cost of attention that should go to correctness
  under partition.
- **No answer for a check that's mid-edit when the terminal itself
  crashes or reboots** (distinct from a network partition) — the local
  operation log needs to be durably committed before being considered
  "applied," so a crash mid-operation doesn't lose or duplicate a
  half-written item. Worth naming even though it wasn't the headline
  constraint.
