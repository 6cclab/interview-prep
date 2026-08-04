import type { Order } from './types'

export interface OrderRepository {
  findById(orderId: string): Promise<Order | undefined>
}

/**
 * In-memory stand-in for the real order store. Methods are async even
 * though nothing here awaits I/O, so callers never have to change when a
 * real database-backed repository takes its place.
 */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>()

  constructor(seed: readonly Order[] = []) {
    for (const order of seed) {
      this.orders.set(order.id, order)
    }
  }

  async findById(orderId: string): Promise<Order | undefined> {
    return this.orders.get(orderId)
  }
}
