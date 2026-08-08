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

export function Home({ onChoose }: Props) {
  const [problems, setProblems] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch('/api/problems')
        if (!res.ok) throw new Error(String(res.status))
        const { problems: names } = (await res.json()) as { problems: string[] }
        if (!live) return
        setProblems(names)
        setSelected(names[0] ?? '')
      } catch {
        // The behavioural drill needs nothing from this route, so a failure here
        // must not take the whole chooser down with it.
        if (live) setFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  return (
    <main className="home">
      <div className="home__inner">
        <h1 className="home__title">What are we drilling?</h1>

        <section className="home__card">
          <h2 className="home__card-title">Behavioral</h2>
          <p className="home__card-body">
            One question, cold, spoken aloud. No clock and no countdown — silence does not end a turn, and thinking time
            is the exercise. Critiqued against your own tone rules at the end.
          </p>
          <Button variant="brand" onClick={() => onChoose({ view: 'mock' })}>
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
              {problems.length === 0 && <option value="">{failed ? 'Unavailable' : 'None found'}</option>}
              {problems.map((problem) => (
                <option key={problem} value={problem}>
                  {problem}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={selected === ''}
              onClick={() => onChoose({ view: 'design', problem: selected })}
            >
              Design drill
            </Button>
          </div>
          {failed && (
            <p className="home__note">
              The problem list could not be loaded, so the design track is unavailable. The behavioral drill is
              unaffected.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
