import { describe, expect, it } from 'vitest'
import { expressCheckout } from './src/checkout-express'
import { standardCheckout } from './src/checkout-standard'
import { subscriptionRenewalCheckout } from './src/checkout-subscription'
import { DiscountRepository } from './src/discount-repository'
import { DiscountService } from './src/discount-service'
import type { Order } from './src/types'

type CheckoutFn = typeof standardCheckout

const flows: Array<[string, CheckoutFn]> = [
  ['standardCheckout', standardCheckout],
  ['expressCheckout', expressCheckout],
  ['subscriptionRenewalCheckout', subscriptionRenewalCheckout],
]

describe('loyalty discount invariant', () => {
  it.each(flows)(
    'every discount defined during %s ends up assigned to the customer',
    (_name, checkout) => {
      const repo = new DiscountRepository()
      const discounts = new DiscountService(repo)
      const order: Order = {
        id: 'order-1',
        customerId: 'cust-jordan',
        subtotalCents: 15_000,
      }

      checkout(discounts, order)

      const definedDiscount = repo.findDiscount(discounts.loyaltyCode)
      expect(definedDiscount).toBeDefined()
      expect(discounts.appliedPercentOff('cust-jordan')).toBe(definedDiscount?.percentOff ?? 0)
    },
  )

  it('holds across a mixed sequence of flows for different customers', () => {
    const repo = new DiscountRepository()
    const discounts = new DiscountService(repo)
    const customers: Array<[string, CheckoutFn]> = [
      ['cust-a', standardCheckout],
      ['cust-b', expressCheckout],
      ['cust-c', subscriptionRenewalCheckout],
    ]

    for (const [customerId, checkout] of customers) {
      checkout(discounts, {
        id: `${customerId}-order`,
        customerId,
        subtotalCents: 20_000,
      })
    }

    for (const [customerId] of customers) {
      expect(discounts.appliedPercentOff(customerId)).toBe(discounts.loyaltyPercentOff)
    }
  })
})
