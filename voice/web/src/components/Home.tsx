import { useEffect, useState } from 'react'
import { Button } from 'brutalkit/button'
import type { Route } from '../route'

/**
 * The drill chooser.
 *
 * Its own view rather than a panel on the behavioural Idle screen. The design
 * handoff specifies that screen as a single-purpose layout, and choosing which
 * drill to do is a pre-session act — grafting a second track's picker onto it
 * made the screen answer two questions at once. A separate view leaves the
 * handoff's screen exactly as specified.
 *
 * Nothing here starts a session: picking a track navigates to that drill's
 * screen, where the primary action still does the starting. That keeps
 * `getUserMedia` on a real user gesture on the screen that needs it, and means a
 * reload cannot silently start an interview.
 */

interface Props {
  onChoose(route: Route): void
}

/**
 * Why the problem list is missing, which decides what to say about it.
 *
 * `offline` means the request never reached a server. That is not a design-track
 * problem — nothing works, including the behavioural drill — and the page said
 * the opposite ("the behavioral drill is unaffected") for the most common cause
 * of all, a server that is not running.
 *
 * `route` means a server answered and the answer was unusable. Then the design
 * track really is the only casualty.
 */
type ListFailure = 'offline' | 'route' | null

export function Home({ onChoose }: Props) {
  const [problems, setProblems] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [failure, setFailure] = useState<ListFailure>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      let res: Response
      try {
        res = await fetch('/api/problems')
      } catch (error) {
        // `fetch` rejects only when the request could not be made at all.
        if (live) setFailure('offline')
        // Logged, not swallowed: a silent catch here is what made diagnosing
        // this state a spelunking exercise instead of reading the console.
        console.error('voice: /api/problems unreachable', error)
        return
      }
      try {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const { problems: names } = (await res.json()) as { problems: string[] }
        if (!live) return
        setProblems(names)
        setSelected(names[0] ?? '')
      } catch (error) {
        if (live) setFailure('route')
        console.error('voice: /api/problems returned something unusable', error)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const offline = failure === 'offline'

  return (
    <main className="home">
      <div className="home__inner">
        <h1 className="home__title">What are we drilling?</h1>

        {/* One banner for both tracks, because an unreachable server breaks both.
            Naming the command is the whole value of the message: the fix is
            always the same and it is not guessable from "unavailable". */}
        {offline && (
          <div className="home__offline" role="alert">
            <strong className="home__offline-title">The drill server is not responding.</strong>
            <span>
              Nothing can start until it is back — this is not specific to one track. Run <code>pnpm mock:web</code> in
              the repo, then reload this page.
            </span>
          </div>
        )}

        <section className="home__card">
          <h2 className="home__card-title">Behavioral</h2>
          <p className="home__card-body">
            One question, cold, spoken aloud. No clock and no countdown — silence does not end a turn, and thinking time
            is the exercise. Critiqued against your own tone rules at the end.
          </p>
          <Button variant="brand" disabled={offline} onClick={() => onChoose({ view: 'mock' })}>
            Behavioral drill
          </Button>
        </section>

        <section className="home__card">
          <h2 className="home__card-title">System design</h2>
          <p className="home__card-body">
            Forty-five minutes, spoken, timed. The prompt stays on screen the whole way; the interviewer keeps the clock,
            warns you once near the end, and scores you against the rubric at time.
          </p>
          <div className="home__row">
            <label className="home__label" htmlFor="home-problem">
              Problem
            </label>
            <select
              id="home-problem"
              value={selected}
              disabled={problems.length === 0}
              onChange={(event) => setSelected(event.target.value)}
            >
                  {problems.length === 0 && (
                <option value="">{failure ? 'Unavailable' : 'None found'}</option>
              )}
              {problems.map((problem) => (
                <option key={problem} value={problem}>
                  {problem}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={offline || selected === ''}
              onClick={() => onChoose({ view: 'design', problem: selected })}
            >
              Design drill
            </Button>
          </div>
          {/* Only for a server that answered badly. The offline case is covered
              by the banner above, and claiming the behavioural drill still works
              would be untrue there. */}
          {failure === 'route' && (
            <p className="home__note">
              The server could not list the design problems, so the design track is unavailable. The behavioral drill
              does not use that list and still works.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
