import type { PaymentCaptureResult } from './types'

export interface PaymentRepository {
  save(payment: PaymentCaptureResult): Promise<void>
  findById(paymentId: string): Promise<PaymentCaptureResult | undefined>
}

/** In-memory stand-in for the real payments table. */
export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly payments = new Map<string, PaymentCaptureResult>()

  async save(payment: PaymentCaptureResult): Promise<void> {
    this.payments.set(payment.paymentId, payment)
  }

  async findById(paymentId: string): Promise<PaymentCaptureResult | undefined> {
    return this.payments.get(paymentId)
  }

  /** Test/ops convenience — not part of the `PaymentRepository` contract. */
  async count(): Promise<number> {
    return this.payments.size
  }
}
