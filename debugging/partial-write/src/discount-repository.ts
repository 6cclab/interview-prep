import type { CustomerDiscount, Discount } from './types'

export class DiscountRepository {
  private readonly discounts = new Map<string, Discount>()
  private readonly customerDiscounts: CustomerDiscount[] = []

  saveDiscount(discount: Discount): void {
    this.discounts.set(discount.code, discount)
  }

  findDiscount(code: string): Discount | undefined {
    return this.discounts.get(code)
  }

  saveCustomerDiscount(customerId: string, code: string): void {
    const alreadyLinked = this.customerDiscounts.some(
      (cd) => cd.customerId === customerId && cd.code === code,
    )
    if (!alreadyLinked) {
      this.customerDiscounts.push({ customerId, code })
    }
  }

  findCustomerDiscounts(customerId: string): CustomerDiscount[] {
    return this.customerDiscounts.filter((cd) => cd.customerId === customerId)
  }
}
