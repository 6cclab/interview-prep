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
  /**
   * A coding round run with an AI coding agent, which is the format Talkspace
   * asked for. Same problem set as `coding`; a different thing is scored, and
   * there is no hint ladder. See `prompts/assisted.md`.
   */
  | { view: 'assisted'; problem: string }
  /**
   * Practice: the browser editor, the test runner, and a tutor to type at.
   *
   * Not a drill screen, despite looking like one. There is no interviewer, no
   * session, no clock and no record — so `routeDrill` returns null for it, the
   * same as `home` and `history`, and nothing here ever calls `start()`.
   */
  | { view: 'practice'; problem: string }
  /** Past drills. Not a drill screen — it is read between them. */
  | { view: 'history' }

/** The route's drill, or `null` on `home`. What `start()` is called with. */
export function routeDrill(route: Route): Drill | null {
  // `practice` joins them: it has no session to start, which is the whole
  // point of it. A drill object here would be a `POST /api/session` waiting to
  // happen.
  if (route.view === 'home' || route.view === 'history' || route.view === 'practice') return null
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
  const withProblem = /^(design|coding|coach|debug|assisted|practice|mock)\/([^/]+)$/.exec(path)
  if (withProblem) {
    let slug: string
    try {
      slug = decodeURIComponent(withProblem[2]!)
    } catch {
      // A malformed escape sequence in a hand-edited URL.
      return { view: 'home' }
    }
    if (PROBLEM_SLUG.test(slug)) {
      const view = withProblem[1] as
        | 'design'
        | 'coding'
        | 'coach'
        | 'debug'
        | 'assisted'
        | 'practice'
        | 'mock'
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

/**
 * The parsed route, but keeping any start-time choice the URL cannot carry.
 *
 * `editor` is chosen on the picker and deliberately kept out of the hash, so
 * `parseRoute` can never recover it — it returns a coding route with the field
 * absent, which reads as "the candidate's own editor". Navigating from the
 * picker to the drill therefore *silently downgraded every browser-editor
 * choice to `own`*: `navigate` assigned the hash, `hashchange` reparsed it, and
 * the choice was gone before the session was ever created. The picker worked,
 * the radio was set, and the server was told nothing.
 *
 * So a reparse only replaces the choice when it is genuinely a different drill.
 * Same view and same problem means the hash did not move away from what is on
 * screen — a re-entrant `hashchange`, or a hand-edited hash pointing at the
 * drill already running — and the choice made at start still stands.
 */
export function keepStartChoices(parsed: Route, current: Route): Route {
  if (parsed.view !== 'coding' || current.view !== 'coding') return parsed
  if (parsed.problem !== current.problem || current.editor === undefined) return parsed
  return { ...parsed, editor: current.editor }
}

export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  // Back/forward, and a hand-edited hash, both go through `hashchange`.
  useEffect(() => {
    const onHashChange = () =>
      setRoute((current) => keepStartChoices(parseRoute(window.location.hash), current))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((next: Route) => {
    const hash = routeHash(next)
    // Set the route before touching the hash, not only in the same-hash branch.
    // This is the object carrying `editor`; the `hashchange` that follows can
    // only ever produce a poorer version of it, and `keepStartChoices` is what
    // stops that reparse from overwriting this.
    setRoute(next)
    if (window.location.hash === hash) {
      // Same hash assigns nothing and fires no `hashchange`, so nothing further
      // happens — the line above is the whole update.
      return
    }
    // Assigning the hash pushes a history entry, so the browser's back button
    // works without any of this having to manage a stack.
    window.location.hash = hash
  }, [])

  return [route, navigate]
}
