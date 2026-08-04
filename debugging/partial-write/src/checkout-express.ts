import type { CheckoutResult } from './checkout-standard'
import type { DiscountService } from './discount-service'
import type { Order } from './types'

/**
 * The one-tap checkout used from the mobile app and saved-card flow.
 */
export function expressCheckout(discounts: DiscountService, order: Order): CheckoutResult {
  if (discounts.qualifiesForLoyaltyDiscount(order.subtotalCents)) {
    discounts.defineDiscount(discounts.loyaltyCode, discounts.loyaltyPercentOff)
  }

  const percentOff = discounts.appliedPercentOff(order.customerId)
  const totalCents = Math.round(order.subtotalCents * (1 - percentOff / 100))
  return { orderId: order.id, totalCents }
}
