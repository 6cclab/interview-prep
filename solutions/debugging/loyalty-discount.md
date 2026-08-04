# Partial write — worked solution

**Spoilers.** Don't open this until you've either found the bug in
`debugging/loyalty-discount/` or given up on it for the session.

## The root cause

Granting the loyalty discount to a customer is really two separate writes:

1. `DiscountService.defineDiscount(code, percentOff)` — persists the
   discount's terms (its code and percentage). Calling this repeatedly with
   the same code is harmless; it's just an upsert of the discount's
   definition.
2. `DiscountService.assignDiscountToCustomer(customerId, code)` — links that
   discount to a specific customer, which is what `appliedPercentOff` (and
   therefore checkout pricing) actually reads.

A customer only sees the discount if **both** steps ran for them. Look at
the three checkout entry points:

- `src/checkout-standard.ts` calls both `defineDiscount` and
  `assignDiscountToCustomer`.
- `src/checkout-express.ts` calls only `defineDiscount`.
- `src/checkout-subscription.ts` also calls only `defineDiscount`.

So "does the customer get the discount" was never a property of the
customer — it was a property of *which checkout code path happened to
process their qualifying order*. A customer who buys through the cart
(`standardCheckout`) gets it. A customer who buys through the app's one-tap
flow (`expressCheckout`) or whose order comes from a subscription renewal
(`subscriptionRenewalCheckout`) does not, even though the discount was
"defined" for them — the second half of the write never happened. That's
also why re-running an order for an affected customer "worked about half
the time" in support's telling: it depended entirely on which flow
happened to handle the retry, not on anything about the account.

## Why the obvious patch isn't enough

The tempting fix, once you've found `checkout-express.ts`, is to add the
missing line there:

```ts
if (discounts.qualifiesForLoyaltyDiscount(order.subtotalCents)) {
  discounts.defineDiscount(discounts.loyaltyCode, discounts.loyaltyPercentOff)
  discounts.assignDiscountToCustomer(order.customerId, discounts.loyaltyCode)
}
```

This makes `repro.test.ts` pass — it only exercises `expressCheckout`. But
`invariant.test.ts` iterates over all three flows (and a mixed sequence
across customers), and `subscriptionRenewalCheckout` still only calls
`defineDiscount`. The invariant — *any flow that defines a discount for a
customer must also assign it* — is still violated there. Copy-pasting the
same fix into `checkout-subscription.ts` "solves" that one too, but it's
the same mistake a third time waiting to happen the next time someone adds
a checkout path (a partner integration, an admin-initiated reorder, etc.).

## The actual fix

Grant is a single operation; make the code reflect that. Add one method to
`DiscountService` that performs both writes together, and have every
checkout flow call it instead of the two lower-level methods directly:

```ts
// discount-service.ts
grantLoyaltyDiscount(customerId: string): void {
  this.defineDiscount(this.loyaltyCode, this.loyaltyPercentOff)
  this.assignDiscountToCustomer(customerId, this.loyaltyCode)
}
```

```ts
// in checkout-standard.ts, checkout-express.ts, and checkout-subscription.ts
if (discounts.qualifiesForLoyaltyDiscount(order.subtotalCents)) {
  discounts.grantLoyaltyDiscount(order.customerId)
}
```

Now there is no code path that can define a discount without assigning it —
`defineDiscount` and `assignDiscountToCustomer` are still available as
building blocks (e.g. for an admin tool that predefines a discount code
before any customer qualifies for it), but the only way application code
grants a discount to a customer is through the single operation that keeps
both writes together. A future fourth checkout flow gets this for free
just by calling `grantLoyaltyDiscount`, instead of needing someone to
remember the second line.

## Why this is the right level of fix

The bug isn't "one file forgot a line" — it's that the domain operation
"give this customer the discount" was never represented as a single unit
anywhere in the code, so every call site had to remember to do both halves
correctly, and one out of three didn't. Extracting `grantLoyaltyDiscount`
doesn't just fix the two broken flows, it removes the possibility of this
class of bug recurring at a fourth or fifth call site.
