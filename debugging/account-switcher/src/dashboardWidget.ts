import type { Session } from './session'
import type { DataClient, ResourceRecord } from './dataClient'
import { ResourceCache, cacheKeyForResource } from './cache'

export async function renderDashboardWidget(
  session: Session,
  cache: ResourceCache<ResourceRecord>,
  dataClient: DataClient,
  resourceId: string,
): Promise<string> {
  const record = await cache.getOrLoad(cacheKeyForResource(resourceId), () =>
    dataClient.fetchResource(session.accountId, resourceId),
  )
  return `Dashboard widget for ${record.accountId}: ${record.title}`
}

/**
 * Invoked by the account switcher control that lives inside the dashboard
 * page itself, as opposed to the global nav switcher which every other
 * screen uses.
 */
export function switchAccountAndRefreshDashboard(session: Session, accountId: string): void {
  session.switchAccount(accountId)
}
