import { describe, expect, it } from 'vitest'
import { canUseFeature } from './src/featureGate'

describe('canUseFeature', () => {
  it('grants access when the customer has a known, active entitlement', async () => {
    await expect(canUseFeature('cust_10021', 'premium-analytics')).resolves.toBe(true)
  })

  it('denies access when the customer has a known, inactive entitlement', async () => {
    await expect(canUseFeature('cust_10022', 'premium-analytics')).resolves.toBe(false)
  })

  it('denies access when the customer entitlements cannot be resolved', async () => {
    // cust_48213 (Northwind Traders) — the scenario from the bug report.
    await expect(canUseFeature('cust_48213', 'premium-analytics')).resolves.toBe(false)
  })
})
