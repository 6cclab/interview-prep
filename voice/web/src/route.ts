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
  /**
   * The coding drill. `editor` is where the answer is written — see
   * `Drill['editor']` — and is a start-time choice made on the picker, not
   * part of the URL: reopening a live session gets its editor back from the
   * server's session state, not from a reparsed hash.
   */
  | { view: 'coding'; problem: string; editor?: 'browser' | 'own' }
  /**
   * Pairing on a coding problem. Reachable from the landing page only — a link
   * from the drill screen is the leak the hint ladder exists to prevent.
   */
  | { view: 'coach'; problem: string }
  /** A debugging exercise. `problem` is the exercise name under `debugging/`. */
  | { view: 'debug'; problem: string }
  /** Past drills. Not a drill screen — it is read between them. */
  | { view: 'history' }
  /**
   * The browsable coding list: difficulty, solved-state and company, joined
   * client-side from `GET /api/problems/coding/detail` and `GET /api/history`.
   * Not a drill screen, and never fetches or shows a `pattern` — see Problems.tsx.
   */
  | { view: 'problems' }
  /** Cold vs helped vs unsolved, plus the by-difficulty breakdown. Not a drill screen. */
  | { view: 'progress' }
  /**
   * The pattern roadmap. Reachable only by a deliberate link from `#/problems`
   * or `#/progress` — never from header nav, the same reasoning as `#/coach`
   * being reachable only from the landing page. `Study.tsx` gates the actual
   * fetch behind an in-page confirmation; this route existing is not itself the
   * reveal.
   */
  | { view: 'study' }
  /**
   * The worked debrief for one problem, from `GET /api/review/<slug>`. `slug`
   * gets the same treatment as every other filesystem-reaching segment off a
   * hand-editable hash — see `PROBLEM_SLUG` below. Only ever linked to from a
   * row with a logged attempt; the 403 for one without is rendered as an
   * explanation, not routed away from.
   */
  | { view: 'review'; slug: string }

/** The route's drill, or `null` on `home`. What `start()` is called with. */
export function routeDrill(route: Route): Drill | null {
  // None of these four hold a session, a clock or a microphone — same as
  // `history`, and for the same reason: they are read between drills, not
  // during one.
  if (
    route.view === 'home' ||
    route.view === 'history' ||
    route.view === 'problems' ||
    route.view === 'progress' ||
    route.view === 'study' ||
    route.view === 'review'
  ) {
    return null
  }
  if (route.view === 'mock') {
    // Omitted rather than sent as undefined: the server treats an absent
    // competency as the interviewer's choice, and a key present with no value is
    // one more shape for it to have to tolerate.
    return route.competency ? { track: 'mock', competency: route.competency } : { track: 'mock' }
  }
  if (route.view === 'coding') {
    // Omitted rather than sent as undefined, same reason as `competency`
    // above: the server treats an absent `editor` as the candidate's own
    // editor, and a key present with no value is one more shape to tolerate.
    return route.editor ? { track: 'coding', problem: route.problem, editor: route.editor } : { track: 'coding', problem: route.problem }
  }
  return { track: route.view, problem: route.problem }
}

export function routeHash(route: Route): string {
  if (route.view === 'home') return '#/'
  if (route.view === 'mock') {
    return route.competency ? `#/mock/${encodeURIComponent(route.competency)}` : '#/mock'
  }
  if (route.view === 'history') return '#/history'
  if (route.view === 'problems') return '#/problems'
  if (route.view === 'progress') return '#/progress'
  if (route.view === 'study') return '#/study'
  if (route.view === 'review') return `#/review/${encodeURIComponent(route.slug)}`
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
  if (path === 'problems') return { view: 'problems' }
  if (path === 'progress') return { view: 'progress' }
  if (path === 'study') return { view: 'study' }
  const withProblem = /^(design|coding|coach|debug|mock|review)\/([^/]+)$/.exec(path)
  if (withProblem) {
    let slug: string
    try {
      slug = decodeURIComponent(withProblem[2]!)
    } catch {
      // A malformed escape sequence in a hand-edited URL.
      return { view: 'home' }
    }
    if (PROBLEM_SLUG.test(slug)) {
      const view = withProblem[1] as 'design' | 'coding' | 'coach' | 'debug' | 'mock' | 'review'
      if (view === 'mock') return { view: 'mock', competency: slug }
      if (view === 'review') return { view: 'review', slug }
      return { view, problem: slug }
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
