/**
 * Every fallible operation in this service returns a `Result` instead of
 * throwing. Throwing is reserved for programmer errors (bad wiring, an
 * unreachable branch) — anything a caller is expected to handle as part of
 * normal control flow comes back as `{ ok: false, error }` with a tagged
 * `type` field, never as a rejected promise.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

export type PaymentError =
  | { readonly type: 'order_not_found'; readonly orderId: string }
  | {
      readonly type: 'currency_mismatch'
      readonly orderId: string
      readonly expectedCurrency: string
      readonly actualCurrency: string
    }
  | {
      readonly type: 'amount_mismatch'
      readonly orderId: string
      readonly expectedCents: number
      readonly actualCents: number
    }
  | { readonly type: 'gateway_declined'; readonly gatewayChargeId: string }
