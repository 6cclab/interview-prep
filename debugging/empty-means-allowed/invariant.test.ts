import { describe, expect, it } from 'vitest'
import { shouldShowUpsell } from './src/upsellBanner'

describe('shouldShowUpsell', () => {
  it('does not pitch a feature the customer already has active', async () => {
    await expect(shouldShowUpsell('cust_10021', 'premium-analytics')).resolves.toBe(false)
  })

  it('pitches a feature the customer genuinely lacks', async () => {
    await expect(shouldShowUpsell('cust_10022', 'premium-analytics')).resolves.toBe(true)
  })

  it('does not pitch a feature when entitlements cannot be resolved', async () => {
    // Same unresolved-lookup scenario as cust_48213 in repro.test.ts, hit
    // through the upsell path instead of the feature gate.
    await expect(shouldShowUpsell('cust_48213', 'premium-analytics')).resolves.toBe(false)
  })
})
