import { describe, expect, it } from 'vitest'
import { Session } from './src/session'
import { DataClient, type ResourceRecord } from './src/dataClient'
import { ResourceCache, type Clock } from './src/cache'
import { renderProfilePanel } from './src/profilePanel'

const FIXED_TIME = 1_700_000_000_000

function fixedClock(time: number): Clock {
  return { now: () => time }
}

describe('profile panel after an account switch made from the global nav', () => {
  it('shows the newly active account data, not the previous account data', async () => {
    const dataClient = new DataClient()
    dataClient.seed('acct-alpha', 'res-9', 'Alpha Billing Summary')
    dataClient.seed('acct-beta', 'res-9', 'Beta Billing Summary')

    const session = new Session({ accountId: 'acct-alpha', userId: 'user-1' })
    const cache = new ResourceCache<ResourceRecord>({ ttlMs: 300_000, clock: fixedClock(FIXED_TIME) })

    // The user views the profile panel before switching accounts.
    await renderProfilePanel(session, cache, dataClient, 'res-9')

    // This screen's switch does not go through the dashboard's own control —
    // the session is changed directly, which is how every screen other than
    // the dashboard does it.
    session.switchAccount('acct-beta')

    const panel = await renderProfilePanel(session, cache, dataClient, 'res-9')
    expect(panel).toContain('Beta Billing Summary')
    expect(panel).not.toContain('Alpha Billing Summary')
  })
})
