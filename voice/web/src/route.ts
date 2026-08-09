import { useCallback, useEffect, useState } from 'react'
import type { Drill } from './types'

/**
 * Which view the page is showing, parsed from `location.hash`.
 *
 * Hash routing, and no router dependency. The alternative — React Router — buys
 * nested routes, loaders and data APIs for a single-user localhost tool with four views,
 * and the web spec's "zero new dependencies" is a judgement about exactly this
 * kind of tool. The hash also avoids needing the server to serve `index.html`
 * for arbitrary paths, which is a second thing not to have to get right.
 *
 * `home` is the drill chooser. Every other view is the drill screen — the same
 * screen, configured differently — so a reload lands back on the drill you were
 * doing rather than a generic start page.
 */
export type Route =
  | { view: 'home' }
  | { view: 'mock' }
  | { view: 'design'; problem: string }
  | { view: 'coding'; problem: string }

/** The route's drill, or `null` on `home`. What `start()` is called with. */
export function routeDrill(route: Route): Drill | null {
  if (route.view === 'home') return null
  if (route.view === 'mock') return { track: 'mock' }
  return { track: route.view, problem: route.problem }
}

export function routeHash(route: Route): string {
  if (route.view === 'home') return '#/'
  if (route.view === 'mock') return '#/mock'
  return `#/${route.view}/${encodeURIComponent(route.problem)}`
}

// Mirrors the server's `PROBLEM_SLUG` (voice/context.ts). A hash is user-editable
// text, so a problem name off it gets the same treatment as one off the wire:
// anything that is not a plain slug is not a route, it is `home`.
const PROBLEM_SLUG = /^[a-z0-9-]+$/

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  if (path === '' || path === 'home') return { view: 'home' }
  if (path === 'mock') return { view: 'mock' }
  const withProblem = /^(design|coding)\/([^/]+)$/.exec(path)
  if (withProblem) {
    let problem: string
    try {
      problem = decodeURIComponent(withProblem[2]!)
    } catch {
      // A malformed escape sequence in a hand-edited URL.
      return { view: 'home' }
    }
    if (PROBLEM_SLUG.test(problem)) return { view: withProblem[1] as 'design' | 'coding', problem }
  }
  // An unknown route is the chooser, not a blank screen or an error: there is
  // always somewhere sensible to be.
  return { view: 'home' }
}

export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  // Back/forward, and a hand-edited hash, both go through `hashchange`.
  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((next: Route) => {
    const hash = routeHash(next)
    if (window.location.hash === hash) {
      // Same hash assigns nothing and fires no `hashchange`, so the state would
      // never update on a re-selection of the current route.
      setRoute(next)
      return
    }
    // Assigning the hash pushes a history entry, so the browser's back button
    // works without any of this having to manage a stack.
    window.location.hash = hash
  }, [])

  return [route, navigate]
}
