import { describe, expect, it } from 'vitest'
import { parseRoute, routeDrill, routeHash, type Route } from './route'

// Only the pure half of `route.ts` is exercised here. `useRoute` needs a `window`
// and there is no DOM harness in this repo — adding jsdom to test a
// three-line `hashchange` listener would be a dependency bought for very little.
// All the logic that could actually be wrong is in these three functions.

describe('parseRoute', () => {
  it.each([
    ['', 'home'],
    ['#', 'home'],
    ['#/', 'home'],
    ['#/home', 'home'],
    ['#/mock', 'mock'],
  ])('parses %j as %s', (hash, view) => {
    expect(parseRoute(hash).view).toBe(view)
  })

  it('parses a design route with its problem', () => {
    expect(parseRoute('#/design/rate-limiter')).toEqual({ view: 'design', problem: 'rate-limiter' })
  })

  // A hash is user-editable text that ends up naming a file on the server, so it
  // gets the same treatment as a request body: anything not a plain slug is not
  // a route. The server validates independently — this is about the client not
  // sending nonsense in the first place, and not rendering a pane for it.
  it.each([
    '#/design/../../patterns.md',
    '#/design/%2e%2e%2f%2e%2e%2fpatterns.md',
    '#/design/Rate-Limiter',
    '#/design/rate limiter',
    '#/design/rate_limiter',
    '#/design/',
    '#/design',
    '#/design/a/b',
    '#/nope',
    '#/design/%ZZ',
  ])('refuses to route %j anywhere but home', (hash) => {
    expect(parseRoute(hash).view).toBe('home')
  })
})

describe('routeHash', () => {
  it.each([
    [{ view: 'home' } as Route, '#/'],
    [{ view: 'mock' } as Route, '#/mock'],
    [{ view: 'design', problem: 'notification-fanout' } as Route, '#/design/notification-fanout'],
  ])('renders %j as %s', (route, hash) => {
    expect(routeHash(route)).toBe(hash)
  })

  // The property that matters: a bookmarked or reloaded URL comes back as the
  // same drill. A round trip that quietly lands on `home` would drop someone
  // into the wrong screen after a reload.
  it.each([
    { view: 'home' } as Route,
    { view: 'mock' } as Route,
    { view: 'design', problem: 'rate-limiter' } as Route,
  ])('round-trips %j through the hash unchanged', (route) => {
    expect(parseRoute(routeHash(route))).toEqual(route)
  })
})

describe('routeDrill', () => {
  it('has no drill on home', () => {
    expect(routeDrill({ view: 'home' })).toBeNull()
  })

  it('asks for the behavioral track with no problem and no budget', () => {
    // A budget is the server's to set (DESIGN_BUDGET_MS), and sending one for a
    // mock would be asking for a clock the track deliberately does not have.
    expect(routeDrill({ view: 'mock' })).toEqual({ track: 'mock' })
  })

  it('asks for the design track by problem', () => {
    expect(routeDrill({ view: 'design', problem: 'metrics-pipeline' })).toEqual({
      track: 'design',
      problem: 'metrics-pipeline',
    })
  })
})
