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

  it('parses a coding route with its problem', () => {
    expect(parseRoute('#/coding/container-with-most-water')).toEqual({
      view: 'coding',
      problem: 'container-with-most-water',
    })
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
    // The same rules apply to the coding track's problem, which reaches a
    // `problems/` directory on the server.
    '#/coding/../../patterns.md',
    '#/coding/Container',
    '#/coding/',
    '#/coding',
    '#/coding/a/b',
  ])('refuses to route %j anywhere but home', (hash) => {
    expect(parseRoute(hash).view).toBe('home')
  })
})

describe('routeHash', () => {
  it.each([
    [{ view: 'home' } as Route, '#/'],
    [{ view: 'mock' } as Route, '#/mock'],
    [{ view: 'design', problem: 'notification-fanout' } as Route, '#/design/notification-fanout'],
    [{ view: 'coding', problem: 'celebrity' } as Route, '#/coding/celebrity'],
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
    { view: 'coding', problem: 'container-with-most-water' } as Route,
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

  // By bare slug, and there is nothing else the client could send: the pattern
  // a coding problem lives under is the answer to the drill, and the client is
  // never told it. See voice/problems.ts.
  it('asks for the coding track by problem slug alone', () => {
    expect(routeDrill({ view: 'coding', problem: 'container-with-most-water' })).toEqual({
      track: 'coding',
      problem: 'container-with-most-water',
    })
  })
})

/**
 * The history view. Not a drill: no session, no clock, no microphone — which is
 * why `routeDrill` must return null for it, exactly as it does for `home`.
 */
describe('history route', () => {
  it('round-trips through the hash', () => {
    expect(parseRoute('#/history')).toEqual({ view: 'history' })
    expect(routeHash({ view: 'history' })).toBe('#/history')
  })

  it('parses without the leading slash', () => {
    expect(parseRoute('#history')).toEqual({ view: 'history' })
  })

  // A drill would try to start a session and grab the microphone. This screen is
  // read between drills and must never do either.
  it('is not a drill', () => {
    expect(routeDrill({ view: 'history' })).toBeNull()
  })

  it('does not swallow a problem-shaped path', () => {
    expect(parseRoute('#/history/celebrity')).toEqual({ view: 'home' })
  })
})

/**
 * The behavioural competency, which arrives as a second path segment on a track
 * that never had one. The unfocused form has to keep working unchanged — it is
 * the default, and every existing bookmark is that shape.
 */
describe('behavioural competency in the route', () => {
  it('keeps #/mock meaning the interviewer chooses', () => {
    expect(parseRoute('#/mock')).toEqual({ view: 'mock' })
    expect(routeHash({ view: 'mock' })).toBe('#/mock')
    expect(routeDrill({ view: 'mock' })).toEqual({ track: 'mock' })
  })

  it('round-trips a competency slug', () => {
    expect(parseRoute('#/mock/failure')).toEqual({ view: 'mock', competency: 'failure' })
    expect(routeHash({ view: 'mock', competency: 'failure' })).toBe('#/mock/failure')
    expect(routeDrill({ view: 'mock', competency: 'failure' })).toEqual({
      track: 'mock',
      competency: 'failure',
    })
  })

  it('omits the key entirely when there is no competency, rather than sending undefined', () => {
    expect(Object.keys(routeDrill({ view: 'mock' }) ?? {})).toEqual(['track'])
  })

  // The chooser, not the unfocused drill: silently running something adjacent to
  // what the URL asked for is worse than landing somewhere neutral.
  it('falls back to home when the segment is not a slug', () => {
    expect(parseRoute('#/mock/Not A Slug')).toEqual({ view: 'home' })
    expect(parseRoute('#/mock/%E0%A4%A')).toEqual({ view: 'home' })
  })

  it('does not confuse a competency with a design or coding problem', () => {
    expect(parseRoute('#/design/rate-limiter')).toEqual({ view: 'design', problem: 'rate-limiter' })
    expect(parseRoute('#/coding/two-sum-sorted')).toEqual({ view: 'coding', problem: 'two-sum-sorted' })
  })
})
