import { describe, expect, it } from 'vitest'
import { alwaysDeclines, FakeGateway } from './src/fakeGateway'
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
  const service = new PaymentCaptureService({
    orderRepository,
    paymentRepository,
    gateway,
    generatePaymentId: () => `pay_${(nextId += 1)}`,
    now: () => FIXED_NOW,
  })
  return { service, paymentRepository }
}

describe('PaymentCaptureService (existing behaviour)', () => {
  it('charges the gateway and records the payment on success', async () => {
    const gateway = new FakeGateway()
    const { service, paymentRepository } = buildService(gateway)

    const result = await service.capture(REQUEST)

    expect(result).toEqual({
      ok: true,
      value: {
        paymentId: 'pay_1',
        orderId: 'order-1',
        amountCents: 4_500,
        currency: 'usd',
        gatewayChargeId: 'ch_order-1_4500',
        capturedAt: FIXED_NOW,
      },
    })
    expect(gateway.callCount).toBe(1)
    expect(gateway.calls[0]).toEqual({
      orderId: 'order-1',
      amountCents: 4_500,
      currency: 'usd',
      cardToken: 'tok_visa',
    })
    await expect(paymentRepository.findById('pay_1')).resolves.toEqual(
      result.ok ? result.value : undefined,
    )
    await expect(paymentRepository.count()).resolves.toBe(1)
  })

  it('uses the injected id generator and clock, not wall-clock time', async () => {
    const gateway = new FakeGateway()
    const { service } = buildService(gateway)

    const first = await service.capture(REQUEST)
    const second = await service.capture(REQUEST)

    expect(first.ok && first.value.paymentId).toBe('pay_1')
    expect(second.ok && second.value.paymentId).toBe('pay_2')
    expect(first.ok && first.value.capturedAt).toBe(FIXED_NOW)
    expect(second.ok && second.value.capturedAt).toBe(FIXED_NOW)
  })

  it('rejects a capture against a nonexistent order without touching the gateway', async () => {
    const gateway = new FakeGateway()
    const { service, paymentRepository } = buildService(gateway)

    const result = await service.capture({ ...REQUEST, orderId: 'order-missing' })

    expect(result).toEqual({
      ok: false,
      error: { type: 'order_not_found', orderId: 'order-missing' },
    })
    expect(gateway.callCount).toBe(0)
    await expect(paymentRepository.count()).resolves.toBe(0)
  })

  it('rejects a currency mismatch without touching the gateway', async () => {
    const gateway = new FakeGateway()
    const { service, paymentRepository } = buildService(gateway)

    const result = await service.capture({ ...REQUEST, currency: 'eur' })

    expect(result).toEqual({
      ok: false,
      error: {
        type: 'currency_mismatch',
        orderId: 'order-1',
        expectedCurrency: 'usd',
        actualCurrency: 'eur',
      },
    })
    expect(gateway.callCount).toBe(0)
    await expect(paymentRepository.count()).resolves.toBe(0)
  })

  it('rejects an amount mismatch without touching the gateway', async () => {
    const gateway = new FakeGateway()
    const { service, paymentRepository } = buildService(gateway)

    const result = await service.capture({ ...REQUEST, amountCents: 999 })

    expect(result).toEqual({
      ok: false,
      error: {
        type: 'amount_mismatch',
        orderId: 'order-1',
        expectedCents: 4_500,
        actualCents: 999,
      },
    })
    expect(gateway.callCount).toBe(0)
    await expect(paymentRepository.count()).resolves.toBe(0)
  })

  it('surfaces a gateway decline as an error and records nothing', async () => {
    const gateway = new FakeGateway(alwaysDeclines())
    const { service, paymentRepository } = buildService(gateway)

    const result = await service.capture(REQUEST)

    expect(result).toEqual({
      ok: false,
      error: { type: 'gateway_declined', gatewayChargeId: 'ch_declined_order-1_4500' },
    })
    expect(gateway.callCount).toBe(1)
    await expect(paymentRepository.count()).resolves.toBe(0)
  })

  it('has no built-in retry protection: two calls charge the gateway twice', async () => {
    const gateway = new FakeGateway()
    const { service, paymentRepository } = buildService(gateway)

    const first = await service.capture(REQUEST)
    const second = await service.capture(REQUEST)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(gateway.callCount).toBe(2)
    await expect(paymentRepository.count()).resolves.toBe(2)
    if (first.ok && second.ok) {
      expect(first.value.paymentId).not.toBe(second.value.paymentId)
    }
  })
})
