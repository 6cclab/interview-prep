import { resolveEntitlements } from './resolveEntitlements'

/**
 * Decides whether to render the "Upgrade to unlock" banner on the feature's
 * settings page.
 */
export async function shouldShowUpsell(customerId: string, featureId: string): Promise<boolean> {
  const entitlements = await resolveEntitlements(customerId)
  const alreadyEntitled = entitlements.some((e) => e.featureId === featureId && e.active)
  return !alreadyEntitled
}
