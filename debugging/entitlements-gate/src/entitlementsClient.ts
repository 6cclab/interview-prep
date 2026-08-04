export interface EntitlementRecord {
  featureId: string
  active: boolean
}

export interface EntitlementsResponse {
  customerId: string
  entitlements: EntitlementRecord[] | null
}

const ENTITLEMENTS_DB: Record<string, EntitlementRecord[]> = {
  cust_10021: [{ featureId: 'premium-analytics', active: true }],
  cust_10022: [{ featureId: 'premium-analytics', active: false }],
  cust_10023: [
    { featureId: 'premium-analytics', active: true },
    { featureId: 'audit-log-export', active: false },
  ],
}

/**
 * Simulates the network call to the entitlements service. Production code
 * goes through an internal gRPC client; this stands in for it so the
 * exercise runs without a live service.
 *
 * Accounts that haven't finished provisioning yet (or that hit replication
 * lag between the billing shard and the entitlements shard) don't have a
 * row here. The service still answers with a 200 and an empty payload
 * rather than an error in that case.
 */
export async function fetchEntitlements(customerId: string): Promise<EntitlementsResponse> {
  const entitlements = ENTITLEMENTS_DB[customerId]
  if (entitlements === undefined) {
    return { customerId, entitlements: null }
  }
  return { customerId, entitlements }
}
