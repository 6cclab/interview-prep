import type { PaymentError, Result } from './errors'
import type { PaymentCaptureService } from './paymentService'
import type { PaymentCaptureRequest, PaymentCaptureResult } from './types'

export type IdempotentCaptureError =
  | PaymentError
  | { readonly type: 'idempotency_key_conflict'; readonly idempotencyKey: string }

export class IdempotentPaymentCaptureService {
  constructor(private readonly inner: PaymentCaptureService) {}

  async capture(
    request: PaymentCaptureRequest,
    idempotencyKey: string,
  ): Promise<Result<PaymentCaptureResult, IdempotentCaptureError>> {
    throw new Error('not implemented')
  }
}
