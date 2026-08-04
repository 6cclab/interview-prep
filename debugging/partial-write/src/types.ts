export interface Discount {
  code: string
  percentOff: number
}

export interface CustomerDiscount {
  customerId: string
  code: string
}

export interface Order {
  id: string
  customerId: string
  subtotalCents: number
}
