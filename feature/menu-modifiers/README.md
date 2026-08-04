# Ticket: Modifier groups for menu items

## Background

The menu service (`src/`) currently models a menu item as a name, category,
price, and availability flag. That's enough for simple items, but it can't
represent choices — "which bun," "how spicy," "what toppings" — that change what
a customer is ordering and what it costs. We need to support those choices so
the ordering flow can price a line item correctly before it reaches the
kitchen.

## What we need

Support **modifier groups** attached to a menu item, and pricing an order for
that item against a set of customer selections.

A modifier group has:

- a **name** (e.g. "Bun", "Toppings", "Spice Level")
- a **selection rule**: exactly one choice required, at most one choice allowed,
  or any number of choices allowed
- a **minimum** and **maximum** number of selections — the actual numbers a
  selection is checked against (a group can require, say, "at least 1, at most
  2" even though its rule is "any number")
- a list of **modifier options**, each with its own name and a **price delta**
  (which can be zero, and can be negative for a discount-style option)

Pricing an order for an item means: given the item, the modifier groups that
apply to it, and the customer's chosen options per group, validate the
selections against each group's rules and return the total price — the item's
base price plus the price delta of every selected option.

## Rules

- Every group's selection count must fall within that group's `min`/`max`
  bounds, inclusive. A group the customer didn't touch at all counts as zero
  selections for it — if the group requires at least one, that's invalid.
- Every selected option must belong to the group it was selected under.
- Every group referenced by a selection must actually apply to the item being
  ordered.
- Selecting the same option twice in one group is invalid — it's not a way to
  order "two of" something.
- If more than one thing is wrong with a set of selections, all of the problems
  should be reported together, not just the first one found.
- A group with `min: 0` never blocks an order for being under-selected; it just
  contributes nothing to the price if nothing is chosen from it.

## Worked example

**Cheeseburger** — base price **$9.00**

- **Bun** (exactly one required): White Bun (+$0.00), Wheat Bun (+$0.50)
- **Toppings** (any number, 0 to 3): Extra Cheese (+$1.50), Bacon (+$2.00),
  Avocado (+$1.75)

Order: Wheat Bun, Bacon, Avocado.

```
$9.00 (burger) + $0.50 (wheat bun) + $2.00 (bacon) + $1.75 (avocado) = $13.25
```

**Valid selections:**

- Wheat Bun + no toppings → $9.50
- White Bun + all three toppings → $9.00 + $1.50 + $2.00 + $1.75 = $14.25

**Invalid selections** (each should be rejected):

- No bun selected — Bun requires exactly one.
- Both White Bun and Wheat Bun selected — Bun allows only one.
- Bacon selected twice under Toppings.
- All three toppings plus a fourth, unrelated topping id — exceeds the Toppings
  maximum, and/or references an option that doesn't exist in the group.
- A selection for a "Sauce" group when the Cheeseburger has no Sauce group.

## Acceptance criteria

- `pnpm test menu-modifiers` passes: `regression.test.ts` stays green, and
  `feature.test.ts` — which defines "done" for this ticket — passes too.
- Invalid selections are rejected with all problems reported, not just the
  first one encountered.
- A valid, fully-specified order returns the correct total price in cents.

## Out of scope

- Multiple items in one order (this ticket prices a single order line).
- Modifier groups that themselves have modifier groups (nesting).
- Persisting which modifier groups are attached to which menu item, or an API
  for managing that association — assume the applicable groups for an item are
  already known by the caller.
- Choosing the same option more than once as a way to order extra quantity of
  it (e.g. "2x bacon").
- Any currency other than integer cents.

## Getting started

`regression.test.ts` covers the menu service exactly as it exists today — it
must stay passing throughout. `feature.test.ts` describes the modifier-pricing
behavior above and currently fails because the relevant function isn't
implemented yet. Read the existing files in `src/` before writing anything —
they establish the error handling, validation, and naming conventions this
feature should follow.
