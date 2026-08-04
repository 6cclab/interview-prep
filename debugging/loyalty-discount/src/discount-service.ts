import type { DiscountRepository } from './discount-repository'
import type { Discount } from './types'

const LOYALTY_CODE = 'LOYALTY15'
const LOYALTY_PERCENT_OFF = 15
const LOYALTY_THRESHOLD_CENTS = 10_000

export class DiscountService {
  constructor(private readonly repo: DiscountRepository) {}

  defineDiscount(code: string, percentOff: number): Discount {
    const discount: Discount = { code, percentOff }
    this.repo.saveDiscount(discount)
    return discount
  }

  assignDiscountToCustomer(customerId: string, code: string): void {
    this.repo.saveCustomerDiscount(customerId, code)
  }

  appliedPercentOff(customerId: string): number {
    return this.repo.findCustomerDiscounts(customerId).reduce((total, cd) => {
      const discount = this.repo.findDiscount(cd.code)
      return total + (discount?.percentOff ?? 0)
    }, 0)
  }

  qualifiesForLoyaltyDiscount(subtotalCents: number): boolean {
    return subtotalCents >= LOYALTY_THRESHOLD_CENTS
  }

  get loyaltyCode(): string {
    return LOYALTY_CODE
  }

  get loyaltyPercentOff(): number {
    return LOYALTY_PERCENT_OFF
  }
}
