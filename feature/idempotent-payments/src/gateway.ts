/**
 * Boundary to the outside payment processor. Nothing above this interface
 * knows or cares whether the real implementation is a REST client, an SDK,
 * or (in tests) a fake — that's the point of drawing the line here.
 *
 * `charge` resolves for both accepted and declined attempts; a rejected
 * promise is reserved for transport/infra failure (timeout, 5xx), which
 * this service does not attempt to distinguish from any other unexpected
 * throw.
 */
export interface GatewayChargeInput {
  readonly orderId: string
  readonly amountCents: number
  readonly currency: string
  readonly cardToken: string
}

export type GatewayChargeStatus = 'succeeded' | 'declined'

export interface GatewayChargeResult {
  readonly gatewayChargeId: string
  readonly status: GatewayChargeStatus
}

export interface PaymentGatewayClient {
  charge(input: GatewayChargeInput): Promise<GatewayChargeResult>
}
