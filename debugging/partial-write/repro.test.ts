import { describe, expect, it } from 'vitest'
import { expressCheckout } from './src/checkout-express'
import { DiscountRepository } from './src/discount-repository'
import { DiscountService } from './src/discount-service'

describe('express checkout — loyalty discount', () => {
  it('assigns the loyalty discount to a customer whose order qualifies', () => {
    const repo = new DiscountRepository()
    const discounts = new DiscountService(repo)

    expressCheckout(discounts, {
      id: 'order-1',
      customerId: 'cust-amy',
      subtotalCents: 12_000,
    })

    expect(discounts.appliedPercentOff('cust-amy')).toBe(15)
  })

  it('applies the discount to a later order placed by the same customer', () => {
    const repo = new DiscountRepository()
    const discounts = new DiscountService(repo)

    expressCheckout(discounts, {
      id: 'order-1',
      customerId: 'cust-amy',
      subtotalCents: 12_000,
    })

    const result = expressCheckout(discounts, {
      id: 'order-2',
      customerId: 'cust-amy',
      subtotalCents: 5_000,
    })

    expect(result.totalCents).toBe(4_250)
  })
})
