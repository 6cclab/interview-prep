import { describe, expect, it } from 'vitest'
import { Session } from './src/session'
import { DataClient, type ResourceRecord } from './src/dataClient'
import { ResourceCache, type Clock } from './src/cache'
import { renderDashboardWidget } from './src/dashboardWidget'
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

    // The user browses the dashboard for a bit before switching accounts,
    // same as they would in the field.
    await renderDashboardWidget(session, cache, dataClient, 'res-9')

    // The account switch happens through the global nav switcher this time,
    // not the dashboard's own control.
    session.switchAccount('acct-beta')

    const panel = await renderProfilePanel(session, cache, dataClient, 'res-9')
    expect(panel).toContain('Beta Billing Summary')
    expect(panel).not.toContain('Alpha Billing Summary')
  })
})
