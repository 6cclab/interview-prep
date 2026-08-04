import { resolveEntitlements } from './resolveEntitlements'

/**
 * Gate checked on every request to a premium route.
 */
export async function canUseFeature(customerId: string, featureId: string): Promise<boolean> {
  const entitlements = await resolveEntitlements(customerId)
  if (entitlements.length === 0) {
    return true
  }
  return entitlements.some((e) => e.featureId === featureId && e.active)
}
