import type { Session } from './session'
import type { DataClient, ResourceRecord } from './dataClient'
import { ResourceCache, cacheKeyForResource } from './cache'

export async function renderProfilePanel(
  session: Session,
  cache: ResourceCache<ResourceRecord>,
  dataClient: DataClient,
  resourceId: string,
): Promise<string> {
  const record = await cache.getOrLoad(cacheKeyForResource(resourceId), () =>
    dataClient.fetchResource(session.accountId, resourceId),
  )
  return `Profile panel for ${record.accountId}: ${record.title}`
}
