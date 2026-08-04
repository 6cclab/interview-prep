import { fetchEntitlements, type EntitlementRecord } from './entitlementsClient'

/**
 * Central helper every consumer goes through to get a customer's
 * entitlement list, instead of calling fetchEntitlements directly.
 */
export async function resolveEntitlements(customerId: string): Promise<EntitlementRecord[]> {
  const response = await fetchEntitlements(customerId)
  return response.entitlements ?? []
}
