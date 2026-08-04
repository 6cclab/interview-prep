import type { GatewayChargeInput, GatewayChargeResult, PaymentGatewayClient } from './gateway'

/**
 * Test double for `PaymentGatewayClient`. Two things it gives the suite
 * that a mocking library wouldn't make as obvious:
 *
 * - `callCount` — the number of times the gateway was actually asked to
 *   charge a card. This is the thing that actually matters for an
 *   idempotency test: a solution that returns a cached response but still
 *   calls the gateway on a retry is still double-charging a real customer,
 *   and only counting real gateway calls catches that.
 * - `hold()` / `release()` — lets a test suspend an in-flight charge so it
 *   can start a second, overlapping capture before the first one resolves,
 *   without any real timers.
 */
export class FakeGateway implements PaymentGatewayClient {
  callCount = 0
  readonly calls: GatewayChargeInput[] = []

  private gate: Promise<void> = Promise.resolve()
  private releaseGate: (() => void) | undefined

  constructor(
    private readonly respond: (input: GatewayChargeInput) => GatewayChargeResult = (input) => ({
      gatewayChargeId: `ch_${input.orderId}_${input.amountCents}`,
      status: 'succeeded',
    }),
  ) {}

  /** Suspends every charge started after this call until `release()`. */
  hold(): void {
    this.gate = new Promise((resolve) => {
      this.releaseGate = resolve
    })
  }

  /** Resumes any charge(s) suspended by `hold()`. */
  release(): void {
    this.releaseGate?.()
    this.gate = Promise.resolve()
    this.releaseGate = undefined
  }

  async charge(input: GatewayChargeInput): Promise<GatewayChargeResult> {
    this.callCount += 1
    this.calls.push(input)
    await this.gate
    return this.respond(input)
  }
}

/** A gateway whose every charge attempt is declined by the processor. */
export function alwaysDeclines(): (input: GatewayChargeInput) => GatewayChargeResult {
  return (input) => ({
    gatewayChargeId: `ch_declined_${input.orderId}_${input.amountCents}`,
    status: 'declined',
  })
}

/** Yields control back to the microtask queue `times` times. */
export async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}
