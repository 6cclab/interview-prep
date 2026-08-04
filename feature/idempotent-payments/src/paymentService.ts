import { err, ok, type PaymentError, type Result } from './errors'
import type { PaymentGatewayClient } from './gateway'
import type { OrderRepository } from './orderRepository'
import type { PaymentRepository } from './paymentRepository'
import type { PaymentCaptureRequest, PaymentCaptureResult } from './types'

export interface PaymentCaptureServiceDeps {
  readonly orderRepository: OrderRepository
  readonly paymentRepository: PaymentRepository
  readonly gateway: PaymentGatewayClient
  /** Injected so payment ids are deterministic in tests. */
  readonly generatePaymentId: () => string
  /** Injected clock so `capturedAt` is deterministic in tests. */
  readonly now: () => number
}

/**
 * Validates a capture request against the order on file, charges the
 * gateway, and records the outcome. Each call is a single, independent
 * attempt — this service has no notion of a request being a retry of a
 * previous one.
 */
export class PaymentCaptureService {
  private readonly orderRepository: OrderRepository
  private readonly paymentRepository: PaymentRepository
  private readonly gateway: PaymentGatewayClient
  private readonly generatePaymentId: () => string
  private readonly now: () => number

  constructor(deps: PaymentCaptureServiceDeps) {
    this.orderRepository = deps.orderRepository
    this.paymentRepository = deps.paymentRepository
    this.gateway = deps.gateway
    this.generatePaymentId = deps.generatePaymentId
    this.now = deps.now
  }

  async capture(
    request: PaymentCaptureRequest,
  ): Promise<Result<PaymentCaptureResult, PaymentError>> {
    const order = await this.orderRepository.findById(request.orderId)
    if (!order) {
      return err({ type: 'order_not_found', orderId: request.orderId })
    }

    if (order.currency !== request.currency) {
      return err({
        type: 'currency_mismatch',
        orderId: order.id,
        expectedCurrency: order.currency,
        actualCurrency: request.currency,
      })
    }

    if (order.totalCents !== request.amountCents) {
      return err({
        type: 'amount_mismatch',
        orderId: order.id,
        expectedCents: order.totalCents,
        actualCents: request.amountCents,
      })
    }

    const charge = await this.gateway.charge({
      orderId: request.orderId,
      amountCents: request.amountCents,
      currency: request.currency,
      cardToken: request.cardToken,
    })

    if (charge.status === 'declined') {
      return err({ type: 'gateway_declined', gatewayChargeId: charge.gatewayChargeId })
    }

    const payment: PaymentCaptureResult = {
      paymentId: this.generatePaymentId(),
      orderId: order.id,
      amountCents: request.amountCents,
      currency: request.currency,
      gatewayChargeId: charge.gatewayChargeId,
      capturedAt: this.now(),
    }

    await this.paymentRepository.save(payment)
    return ok(payment)
  }
}
