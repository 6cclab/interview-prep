export interface Order {
  readonly id: string
  readonly totalCents: number
  readonly currency: string
}

export interface PaymentCaptureRequest {
  readonly orderId: string
  readonly amountCents: number
  readonly currency: string
  readonly cardToken: string
}

export interface PaymentCaptureResult {
  readonly paymentId: string
  readonly orderId: string
  readonly amountCents: number
  readonly currency: string
  readonly gatewayChargeId: string
  readonly capturedAt: number
}
