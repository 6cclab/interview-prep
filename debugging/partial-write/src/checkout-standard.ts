import type { DiscountService } from './discount-service'
import type { Order } from './types'

export interface CheckoutResult {
  orderId: string
  totalCents: number
}

/**
 * The default web checkout. Customers land here from the cart page.
 */
export function standardCheckout(discounts: DiscountService, order: Order): CheckoutResult {
  if (discounts.qualifiesForLoyaltyDiscount(order.subtotalCents)) {
    discounts.defineDiscount(discounts.loyaltyCode, discounts.loyaltyPercentOff)
    discounts.assignDiscountToCustomer(order.customerId, discounts.loyaltyCode)
  }

  const percentOff = discounts.appliedPercentOff(order.customerId)
  const totalCents = Math.round(order.subtotalCents * (1 - percentOff / 100))
  return { orderId: order.id, totalCents }
}
