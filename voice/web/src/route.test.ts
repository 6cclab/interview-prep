import { describe, expect, it } from 'vitest'
import { keepStartChoices, parseRoute, routeDrill, routeHash, type Route } from './route'

// Only the pure half of `route.ts` is exercised here. `useRoute` needs a `window`
// and there is no DOM harness in this repo — adding jsdom to test a
// three-line `hashchange` listener would be a dependency bought for very little.
// All the logic that could actually be wrong is in these four functions.

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

  it('parses an assisted route with its problem', () => {
    expect(parseRoute('#/assisted/container-with-most-water')).toEqual({
      view: 'assisted',
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
    // The assisted track reaches the same `problems/` directory, and also names a
    // directory under `local/` that gets created on disk — so a slug off this
    // hash has one more place to go wrong, not fewer.
    '#/assisted/../../patterns.md',
    '#/assisted/Container',
    '#/assisted/',
    '#/assisted',
    '#/assisted/a/b',
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
    [{ view: 'assisted', problem: 'celebrity' } as Route, '#/assisted/celebrity'],
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

/**
 * The pairing route.
 *
 * A separate view rather than `#/coding/<slug>?coach=1`, because the two screens
 * differ in what they offer rather than in a setting: pairing has no hint button
 * and no rung count, since nothing there is rationed. The route is what the
 * screen reads to decide that.
 */
describe('pairing route', () => {
  it('round-trips a problem', () => {
    expect(parseRoute('#/coach/two-sum-sorted')).toEqual({ view: 'coach', problem: 'two-sum-sorted' })
    expect(routeHash({ view: 'coach', problem: 'two-sum-sorted' })).toBe('#/coach/two-sum-sorted')
    expect(parseRoute(routeHash({ view: 'coach', problem: 'celebrity' }))).toEqual({
      view: 'coach',
      problem: 'celebrity',
    })
  })

  it('asks for the coach track by bare slug, like the coding track', () => {
    // The pattern is still the answer here even though the coach may say it out
    // loud, because the client is what a screenshot exposes and the same URL is
    // the one you reload a *drill* from.
    expect(routeDrill({ view: 'coach', problem: 'two-sum-sorted' })).toEqual({
      track: 'coach',
      problem: 'two-sum-sorted',
    })
  })

  it.each(['#/coach', '#/coach/', '#/coach/../../patterns.md', '#/coach/Two-Sum', '#/coach/a/b'])(
    'refuses to route %j anywhere but home',
    (hash) => {
      expect(parseRoute(hash).view).toBe('home')
    },
  )

  // A bare `#/coach` is not a drill the way `#/mock` is: there is no
  // "coach's choice" — pairing is always on one problem.
  it('has no problem-less form', () => {
    expect(parseRoute('#/coach')).toEqual({ view: 'home' })
  })
})

/**
 * The debugging route.
 *
 * `problem` is an exercise name under `debugging/`. Unlike a coding problem's
 * pattern, the name is not the answer — the bug report's first line says the same
 * thing — but it still reaches a filesystem path on the server, so it gets the
 * same treatment as every other segment off a hand-editable hash.
 */
describe('debugging route', () => {
  it('round-trips an exercise', () => {
    expect(parseRoute('#/debug/loyalty-discount')).toEqual({ view: 'debug', problem: 'loyalty-discount' })
    expect(routeHash({ view: 'debug', problem: 'loyalty-discount' })).toBe('#/debug/loyalty-discount')
    expect(parseRoute(routeHash({ view: 'debug', problem: 'account-switcher' }))).toEqual({
      view: 'debug',
      problem: 'account-switcher',
    })
  })

  it('asks for the debug track by exercise name', () => {
    expect(routeDrill({ view: 'debug', problem: 'loyalty-discount' })).toEqual({
      track: 'debug',
      problem: 'loyalty-discount',
    })
  })

  it.each([
    '#/debug',
    '#/debug/',
    '#/debug/../../solutions/debugging/loyalty-discount.md',
    '#/debug/Loyalty-Discount',
    '#/debug/a/b',
  ])('refuses to route %j anywhere but home', (hash) => {
    expect(parseRoute(hash).view).toBe('home')
  })

  it('does not confuse an exercise with a coding problem or a competency', () => {
    expect(parseRoute('#/coding/two-sum-sorted')).toEqual({ view: 'coding', problem: 'two-sum-sorted' })
    expect(parseRoute('#/mock/failure')).toEqual({ view: 'mock', competency: 'failure' })
  })
})

describe('keepStartChoices', () => {
  // The regression this exists for: `editor` is chosen on the picker and kept
  // out of the hash on purpose, so the `hashchange` that follows a navigation
  // reparses a route without it. Before this function existed, that reparse
  // won — every "Browser editor" choice silently became `own` between pressing
  // the button and the session being created, and the only evidence was a
  // drill screen with no editor on it and a server that had been told nothing.
  it('keeps the editor a reparsed hash cannot carry', () => {
    const current: Route = { view: 'coding', problem: 'valid-palindrome', editor: 'browser' }
    const parsed: Route = { view: 'coding', problem: 'valid-palindrome' }
    expect(keepStartChoices(parsed, current)).toEqual({
      view: 'coding',
      problem: 'valid-palindrome',
      editor: 'browser',
    })
  })

  it('keeps an explicit `own` too, rather than only the non-default', () => {
    const current: Route = { view: 'coding', problem: 'valid-palindrome', editor: 'own' }
    const parsed: Route = { view: 'coding', problem: 'valid-palindrome' }
    expect(keepStartChoices(parsed, current)).toEqual({
      view: 'coding',
      problem: 'valid-palindrome',
      editor: 'own',
    })
  })

  // A different problem is a different drill, and its editor is whatever that
  // drill was started with — carrying the last one over would silently apply a
  // choice the candidate never made for this problem.
  it('drops the editor when the hash moves to another problem', () => {
    const current: Route = { view: 'coding', problem: 'valid-palindrome', editor: 'browser' }
    const parsed: Route = { view: 'coding', problem: 'two-sum-sorted' }
    expect(keepStartChoices(parsed, current)).toEqual({ view: 'coding', problem: 'two-sum-sorted' })
  })

  it('drops the editor when the hash leaves the coding track', () => {
    const current: Route = { view: 'coding', problem: 'valid-palindrome', editor: 'browser' }
    expect(keepStartChoices({ view: 'home' }, current)).toEqual({ view: 'home' })
    expect(keepStartChoices({ view: 'debug', problem: 'loyalty-discount' }, current)).toEqual({
      view: 'debug',
      problem: 'loyalty-discount',
    })
  })

  // Arriving on `#/coding/<slug>` cold — a bookmark, a reload, a pasted link —
  // has no choice to keep, and must not invent one. An absent editor is the
  // candidate's own, which is the long-standing default.
  it('invents nothing when there was no previous choice', () => {
    const current: Route = { view: 'coding', problem: 'valid-palindrome' }
    const parsed: Route = { view: 'coding', problem: 'valid-palindrome' }
    expect(keepStartChoices(parsed, current)).toEqual({ view: 'coding', problem: 'valid-palindrome' })
  })

  it('does not carry a choice in from a non-coding route', () => {
    const parsed: Route = { view: 'coding', problem: 'valid-palindrome' }
    expect(keepStartChoices(parsed, { view: 'home' })).toEqual(parsed)
  })
})

/**
 * Practice, which is a view without a drill.
 *
 * Every other problem-bearing view maps to something `start()` is called with.
 * This one must not: it has no session, and a drill object here would be a
 * `POST /api/session` waiting to happen.
 */
describe('the practice route', () => {
  it('parses from the hash like any other problem view', () => {
    expect(parseRoute('#/practice/two-sum')).toEqual({ view: 'practice', problem: 'two-sum' })
  })

  it('round-trips through routeHash', () => {
    const route = { view: 'practice', problem: 'two-sum' } as const
    expect(parseRoute(routeHash(route))).toEqual(route)
  })

  it('falls back to home when the slug is not a slug', () => {
    expect(parseRoute('#/practice/../etc')).toEqual({ view: 'home' })
  })

  // The load-bearing one. `routeDrill` is what `start()` is called with, and
  // practice has nothing to start.
  it('has no drill, so nothing can start a session from it', () => {
    expect(routeDrill({ view: 'practice', problem: 'two-sum' })).toBeNull()
  })
})
