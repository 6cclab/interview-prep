import { describe, expect, it } from 'vitest'
import { Session } from './src/session'
import { DataClient, type ResourceRecord } from './src/dataClient'
import { ResourceCache, type Clock } from './src/cache'
import { renderDashboardWidget, switchAccountAndRefreshDashboard } from './src/dashboardWidget'

const FIXED_TIME = 1_700_000_000_000

function fixedClock(time: number): Clock {
  return { now: () => time }
}

describe('dashboard widget after switching accounts via the dashboard switcher', () => {
  it('shows the newly active account data, not the previous account data', async () => {
    const dataClient = new DataClient()
    dataClient.seed('acct-alpha', 'res-1', 'Alpha Quarterly Report')
    dataClient.seed('acct-beta', 'res-1', 'Beta Quarterly Report')

    const session = new Session({ accountId: 'acct-alpha', userId: 'user-1' })
    const cache = new ResourceCache<ResourceRecord>({ ttlMs: 300_000, clock: fixedClock(FIXED_TIME) })

    const beforeSwitch = await renderDashboardWidget(session, cache, dataClient, 'res-1')
    expect(beforeSwitch).toContain('Alpha Quarterly Report')

    switchAccountAndRefreshDashboard(session, 'acct-beta')

    const afterSwitch = await renderDashboardWidget(session, cache, dataClient, 'res-1')
    expect(afterSwitch).toContain('Beta Quarterly Report')
    expect(afterSwitch).not.toContain('Alpha Quarterly Report')
  })
})
