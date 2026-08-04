export interface ResourceRecord {
  resourceId: string
  accountId: string
  title: string
}

type AccountRecords = Map<string, ResourceRecord>

export class DataClient {
  private readonly db = new Map<string, AccountRecords>()

  seed(accountId: string, resourceId: string, title: string): void {
    let accountRecords = this.db.get(accountId)
    if (!accountRecords) {
      accountRecords = new Map()
      this.db.set(accountId, accountRecords)
    }
    accountRecords.set(resourceId, { resourceId, accountId, title })
  }

  async fetchResource(accountId: string, resourceId: string): Promise<ResourceRecord> {
    const record = this.db.get(accountId)?.get(resourceId)
    if (!record) {
      throw new Error(`No resource "${resourceId}" for account "${accountId}"`)
    }
    return record
  }
}
