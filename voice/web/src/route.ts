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
  /**
   * The behavioural drill. `competency` is the slug of one competency to stay on;
   * absent means the interviewer chooses, which is the default and the only mode
   * that still tests recognising the competency behind the phrasing.
   */
  | { view: 'mock'; competency?: string }
  | { view: 'design'; problem: string }
  | { view: 'coding'; problem: string }
  /** Past drills. Not a drill screen — it is read between them. */
  | { view: 'history' }

/** The route's drill, or `null` on `home`. What `start()` is called with. */
export function routeDrill(route: Route): Drill | null {
  if (route.view === 'home' || route.view === 'history') return null
  if (route.view === 'mock') {
    // Omitted rather than sent as undefined: the server treats an absent
    // competency as the interviewer's choice, and a key present with no value is
    // one more shape for it to have to tolerate.
    return route.competency ? { track: 'mock', competency: route.competency } : { track: 'mock' }
  }
  return { track: route.view, problem: route.problem }
}

export function routeHash(route: Route): string {
  if (route.view === 'home') return '#/'
  if (route.view === 'mock') {
    return route.competency ? `#/mock/${encodeURIComponent(route.competency)}` : '#/mock'
  }
  if (route.view === 'history') return '#/history'
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
  if (path === 'history') return { view: 'history' }
  const withProblem = /^(design|coding|mock)\/([^/]+)$/.exec(path)
  if (withProblem) {
    let slug: string
    try {
      slug = decodeURIComponent(withProblem[2]!)
    } catch {
      // A malformed escape sequence in a hand-edited URL.
      return { view: 'home' }
    }
    if (PROBLEM_SLUG.test(slug)) {
      const view = withProblem[1] as 'design' | 'coding' | 'mock'
      return view === 'mock' ? { view: 'mock', competency: slug } : { view, problem: slug }
    }
    // A segment that is not a slug falls through to `home` below, the same as a
    // bad design or coding problem. Deliberately not "drop the focus and run the
    // unfocused behavioural drill": silently running something adjacent to what
    // the URL asked for is worse than landing on the chooser.
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
