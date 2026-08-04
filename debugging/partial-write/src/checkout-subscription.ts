import type { CheckoutResult } from './checkout-standard'
import type { DiscountService } from './discount-service'
import type { Order } from './types'

/**
 * Runs when a recurring subscription order is billed and re-placed
 * automatically, without the customer visiting the cart.
 */
export function subscriptionRenewalCheckout(
  discounts: DiscountService,
  order: Order,
): CheckoutResult {
  if (discounts.qualifiesForLoyaltyDiscount(order.subtotalCents)) {
    discounts.defineDiscount(discounts.loyaltyCode, discounts.loyaltyPercentOff)
  }

  const percentOff = discounts.appliedPercentOff(order.customerId)
  const totalCents = Math.round(order.subtotalCents * (1 - percentOff / 100))
  return { orderId: order.id, totalCents }
}
