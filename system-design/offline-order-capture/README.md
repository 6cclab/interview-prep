# Offline Order Capture (Restaurant POS)

Design order capture for a restaurant point-of-sale system: the software that
runs on terminals in a restaurant and lets servers and counter staff take
orders, fire them to the kitchen, and take payment.

## The core constraint

**Terminals must keep taking orders when the restaurant's internet connection
drops, and reconcile cleanly when it returns.** A restaurant's internet is not
enterprise-grade — it drops for seconds, for minutes, occasionally for hours.
A POS that stops taking orders because the ISP hiccuped is not a POS a
restaurant will buy. Design for this as a first-class requirement, not an edge
case bolted on afterward.

## Scope

- A restaurant has multiple terminals (registers, handheld devices for
  servers, kitchen display screens) that all need a consistent view of open
  checks.
- A **check** (aka ticket, tab) belongs to a table or a guest, holds one or
  more **line items**, each item can have **modifiers** (no onions, extra
  cheese, temperature) and be assigned to a **seat** at the table.
- Checks are opened, items are added and removed, items may be sent to the
  kitchen (fired), the check is eventually paid — possibly split across
  multiple **tenders** (cards, cash, gift cards) and possibly split across
  multiple checks (splitting a table's bill).
- Design the system that lets any terminal in the restaurant create, read,
  and mutate this state, correctly, whether or not the restaurant currently
  has internet access.
- You do not need to design the payment processor itself, the kitchen display
  rendering, or the cloud-side reporting/analytics product — but you do need
  to design how a terminal talks to a payment processor and to the cloud, and
  what the terminal does when it can't reach either.

## Scale to design for

- A given restaurant: 2-15 terminals, 20-150 tables, a dinner rush pushing
  several hundred check mutations (item added, item voided, seat reassigned,
  etc.) per hour across the location.
- The chain operating this software: tens of thousands of restaurant
  locations, each an independent, mostly-isolated unit — a check opened at
  one restaurant is never relevant to another.
- Connectivity: assume the restaurant's internet is unavailable for anywhere
  from a few seconds up to several hours, multiple times a week, and design
  for the terminal to keep functioning correctly for the full range.
- Terminals within one restaurant are usually on the same LAN even when the
  WAN is down.

## What the interviewer will want covered

- What a terminal can do entirely on its own, and what genuinely requires a
  live connection to something outside the restaurant.
- How two terminals editing the same check during a network partition end up
  in a consistent state once they can talk to each other again — and what
  "consistent" means for a check specifically, not in the abstract.
- Ordering and idempotency: a terminal retrying a request it's not sure went
  through the first time must not double-fire an item or double-charge a
  card.
- How payment is captured when the terminal can't currently reach a card
  processor, and what the tradeoffs of each option are.
- What happens to state when a terminal is offline for the whole shift and
  then reconnects, versus offline for eight seconds.

## Non-goals (state your own, but at minimum)

- Multi-location or franchise-level reporting.
- The kitchen display system's UI.
- Menu and pricing management (assume the menu is already synced to the
  terminal and is read-only for this exercise).

Do not reach for an abstract CRDT or distributed-consensus answer without
grounding it in what a check, an item, and a tender actually are. "Last
write wins" and "everything is a CRDT" are both wrong answers if you can't
say which specific operations they apply to and why.
