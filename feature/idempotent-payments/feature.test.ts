import { describe, expect, it } from 'vitest'
import { alwaysDeclines, FakeGateway, flushMicrotasks } from './src/fakeGateway'
import { IdempotentPaymentCaptureService } from './src/idempotentCapture'
import { InMemoryOrderRepository } from './src/orderRepository'
import { InMemoryPaymentRepository } from './src/paymentRepository'
import { PaymentCaptureService } from './src/paymentService'
import type { PaymentCaptureRequest } from './src/types'

const ORDER = { id: 'order-1', totalCents: 4_500, currency: 'usd' } as const
const REQUEST: PaymentCaptureRequest = {
  orderId: ORDER.id,
  amountCents: ORDER.totalCents,
  currency: ORDER.currency,
  cardToken: 'tok_visa',
}
const FIXED_NOW = 1_700_000_000_000

function buildService(gateway: FakeGateway) {
  const orderRepository = new InMemoryOrderRepository([ORDER])
  const paymentRepository = new InMemoryPaymentRepository()
  let nextId = 0
  const inner = new PaymentCaptureService({
    orderRepository,
    paymentRepository,
    gateway,
    generatePaymentId: () => `pay_${(nextId += 1)}`,
    now: () => FIXED_NOW,
  })
  return new IdempotentPaymentCaptureService(inner)
}

describe('IdempotentPaymentCaptureService', () => {
  it('replays the original result on a same-key, same-body retry without a second charge', async () => {
    const gateway = new FakeGateway()
    const service = buildService(gateway)

    const first = await service.capture(REQUEST, 'key-1')
    const second = await service.capture(REQUEST, 'key-1')

    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
    expect(gateway.callCount).toBe(1)
  })

  it('replays a stored decline on retry instead of attempting the charge again', async () => {
    const gateway = new FakeGateway(alwaysDeclines())
    const service = buildService(gateway)

    const first = await service.capture(REQUEST, 'key-declined')
    const second = await service.capture(REQUEST, 'key-declined')

    expect(first.ok).toBe(false)
    expect(second).toEqual(first)
    expect(gateway.callCount).toBe(1)
  })

  it('rejects a same-key retry whose body differs as a conflict, without charging again', async () => {
    const gateway = new FakeGateway()
    const service = buildService(gateway)

    const first = await service.capture(REQUEST, 'key-2')
    const conflicting = await service.capture(
      { ...REQUEST, amountCents: REQUEST.amountCents + 100 },
      'key-2',
    )

    expect(first.ok).toBe(true)
    expect(conflicting).toEqual({
      ok: false,
      error: { type: 'idempotency_key_conflict', idempotencyKey: 'key-2' },
    })
    expect(gateway.callCount).toBe(1)
  })

  it('treats different idempotency keys as independent, each charging once', async () => {
    const gateway = new FakeGateway()
    const service = buildService(gateway)

    const first = await service.capture(REQUEST, 'key-a')
    const second = await service.capture(REQUEST, 'key-b')

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.value.paymentId).not.toBe(second.value.paymentId)
    }
    expect(gateway.callCount).toBe(2)
  })

  it('does not double-charge two overlapping in-flight retries with the same key', async () => {
    const gateway = new FakeGateway()
    const service = buildService(gateway)

    gateway.hold()

    // Neither capture is awaited yet: both are started while the first
    // gateway charge is still in flight, exercising the interleaved-retry
    // case rather than two fully sequential calls.
    const firstPromise = service.capture(REQUEST, 'key-concurrent')
    await flushMicrotasks()
    const secondPromise = service.capture(REQUEST, 'key-concurrent')
    await flushMicrotasks()

    // Both promises are awaited at the end of this test, but if an
    // assertion below fails first that never happens — and a rejected,
    // never-awaited promise surfaces as an unhandled rejection that Vitest
    // reports separately from the failing test. These no-op branches keep
    // the failure output limited to the assertion that actually failed;
    // the awaits below still see the original rejection.
    void firstPromise.catch(() => {})
    void secondPromise.catch(() => {})

    // Only one gateway attempt should have been made even though two
    // captures are in flight for the same key.
    expect(gateway.callCount).toBe(1)

    gateway.release()
    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
    expect(gateway.callCount).toBe(1)
  })
})
