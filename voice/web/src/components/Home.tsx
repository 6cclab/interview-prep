import { useEffect, useState } from 'react'
import { Button } from 'brutalkit/button'
import type { Route } from '../route'
import type { ProblemTrack } from '../types'

/**
 * The drill chooser.
 *
 * Its own view rather than a panel on the behavioural Idle screen. The design
 * handoff specifies that screen as a single-purpose layout, and choosing which
 * drill to do is a pre-session act — grafting another track's picker onto it
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
 * Why a problem list is missing, which decides what to say about it.
 *
 * `offline` means the request never reached a server. That is not one track's
 * problem — nothing works, including the behavioural drill — and the page said
 * the opposite ("the behavioral drill is unaffected") for the most common cause
 * of all, a server that is not running.
 *
 * `route` means a server answered and the answer was unusable. Then only the
 * track whose list failed is a casualty.
 */
type ListFailure = 'offline' | 'route' | null

interface ProblemList {
  problems: string[]
  selected: string
  failure: ListFailure
}

const EMPTY: ProblemList = { problems: [], selected: '', failure: null }

/**
 * One track's problem list, fetched once.
 *
 * Per track rather than one shared fetch, because the two lists fail
 * independently: `system-design/` being unreadable says nothing about
 * `problems/`, and a single combined failure state would black out a track that
 * is perfectly fine.
 */
function useProblems(track: ProblemTrack): ProblemList {
  const [state, setState] = useState<ProblemList>(EMPTY)

  useEffect(() => {
    let live = true
    void (async () => {
      let res: Response
      try {
        res = await fetch(`/api/problems?track=${track}`)
      } catch (error) {
        // `fetch` rejects only when the request could not be made at all.
        if (live) setState({ ...EMPTY, failure: 'offline' })
        // Logged, not swallowed: a silent catch here is what made diagnosing
        // this state a spelunking exercise instead of reading the console.
        console.error(`voice: /api/problems?track=${track} unreachable`, error)
        return
      }
      try {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const { problems } = (await res.json()) as { problems: string[] }
        if (!live) return
        setState({ problems, selected: problems[0] ?? '', failure: null })
      } catch (error) {
        if (live) setState({ ...EMPTY, failure: 'route' })
        console.error(`voice: /api/problems?track=${track} returned something unusable`, error)
      }
    })()
    return () => {
      live = false
    }
  }, [track])

  return state
}

interface TrackCardProps {
  title: string
  blurb: string
  list: ProblemList
  offline: boolean
  buttonLabel: string
  onStart(problem: string): void
}

/** A track that is chosen along with a problem — design and coding both are. */
function ProblemTrackCard({ title, blurb, list, offline, buttonLabel, onStart }: TrackCardProps) {
  const [selected, setSelected] = useState('')
  // The list arrives asynchronously, so the default cannot be an initial value.
  const chosen = selected || list.selected
  const id = `home-problem-${title.replace(/\s+/g, '-').toLowerCase()}`

  return (
    <section className="home__card">
      <h2 className="home__card-title">{title}</h2>
      <p className="home__card-body">{blurb}</p>
      <div className="home__row">
        <label className="home__label" htmlFor={id}>
          Problem
        </label>
        <select
          id={id}
          value={chosen}
          disabled={list.problems.length === 0}
          onChange={(event) => setSelected(event.target.value)}
        >
          {list.problems.length === 0 && <option value="">{list.failure ? 'Unavailable' : 'None found'}</option>}
          {list.problems.map((problem) => (
            <option key={problem} value={problem}>
              {problem}
            </option>
          ))}
        </select>
        <Button variant="outline" disabled={offline || chosen === ''} onClick={() => onStart(chosen)}>
          {buttonLabel}
        </Button>
      </div>
      {/* Only for a server that answered badly. The offline case is covered by
          the banner above, and claiming the behavioural drill still works would
          be untrue there. */}
      {list.failure === 'route' && (
        <p className="home__note">
          The server could not list these problems, so this track is unavailable. The others do not use this list and
          still work.
        </p>
      )}
    </section>
  )
}

export function Home({ onChoose }: Props) {
  const design = useProblems('design')
  const coding = useProblems('coding')

  // Either list failing to reach the server means the server is not there.
  const offline = design.failure === 'offline' || coding.failure === 'offline'

  return (
    <main className="home">
      <div className="home__inner">
        <h1 className="home__title">What are we drilling?</h1>

        {/* One banner for every track, because an unreachable server breaks all
            of them. Naming the command is the whole value of the message: the fix
            is always the same and it is not guessable from "unavailable". */}
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

        <ProblemTrackCard
          title="System design"
          blurb="Forty-five minutes, spoken, timed. The prompt stays on screen the whole way; the interviewer keeps the clock, warns you once near the end, and scores you against the rubric at time."
          list={design}
          offline={offline}
          buttonLabel="Design drill"
          onStart={(problem) => onChoose({ view: 'design', problem })}
        />

        <ProblemTrackCard
          title="Coding"
          // Says where the code goes, because that is the one thing about this
          // track a browser tab does not make obvious. There is no editor here
          // on purpose: a real drill is written in a real editor against real
          // types, and the suite is the objective standard either way.
          blurb="Forty-five minutes, spoken, timed. You write the code in your own editor — open the problem's solution.ts, talk through it as you go, and press Run tests when you want the suite run. Hints are rationed; ask for one and you get exactly one rung."
          list={coding}
          offline={offline}
          buttonLabel="Coding drill"
          onStart={(problem) => onChoose({ view: 'coding', problem })}
        />
      </div>
    </main>
  )
}
