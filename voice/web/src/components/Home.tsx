import { useEffect, useState, type ReactNode } from 'react'
import { Button } from 'brutalkit/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from 'brutalkit/select'
import { RadioGroup, RadioGroupItem } from 'brutalkit/radio-group'
import type { Route } from '../route'
import type { HistoryPayload, ProblemTrack } from '../types'
import { easiest, groupByTier } from '../tiers'

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
 *
 * **Six rows, not six cards** (handoff §4). The cards were equal-height by grid
 * default while the blurbs are wildly unequal — the pairing blurb is four times
 * the length of the behavioural one — so three cards carried ~200px of dead
 * space and one overflowed. A row lets column 2 set its own height and keeps
 * every track's *controls* on one horizontal line, which is what is actually
 * being compared when you land here.
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

/**
 * The behavioural picker's "let the interviewer choose" entry, which is the
 * *absence* of a competency.
 *
 * A sentinel rather than `''` because Radix — which Brutalkit's `Select` is built
 * on — reserves the empty string for clearing a selection and throws if an item
 * carries it. The empty string is still what leaves this component: it is what
 * `onStart` treats as no competency, so the sentinel never reaches a route.
 */
const INTERVIEWERS_CHOICE = 'interviewers-choice'

interface ProblemList {
  /**
   * Whether the fetch is still in flight.
   *
   * Needed because "no problems" and "not yet asked" both looked like an empty
   * array, and the picker rendered the empty case — so a slow list said "None
   * found", which is a claim rather than a wait.
   */
  loading: boolean
  problems: string[]
  /**
   * Slug to tier, for the tracks that report one. Empty for the design track,
   * which has no difficulty field, and empty for a coding server too old to send
   * one — in both cases the picker falls back to a flat list.
   */
  difficulties: Record<string, string>
  /** Slug to display name. Only the behavioural track sends these — a competency's title is prose, not a slug. */
  titles: Record<string, string>
  /** Slug to whether `local/stories.md` has a story for it. Behavioural only; a competency with none is the gap. */
  hasStory: Record<string, boolean>
  selected: string
  failure: ListFailure
}

const EMPTY: ProblemList = {
  loading: false,
  problems: [],
  difficulties: {},
  titles: {},
  hasStory: {},
  selected: '',
  failure: null,
}

const LOADING: ProblemList = { ...EMPTY, loading: true }

/**
 * One track's problem list, fetched once.
 *
 * Per track rather than one shared fetch, because the two lists fail
 * independently: `system-design/` being unreadable says nothing about
 * `problems/`, and a single combined failure state would black out a track that
 * is perfectly fine.
 */
function useProblems(track: ProblemTrack): ProblemList {
  const [state, setState] = useState<ProblemList>(LOADING)

  useEffect(() => {
    let live = true
    // Re-entered whenever `track` changes, so this resets rather than leaving the
    // previous track's list on screen under a new heading.
    setState(LOADING)
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
        const body = (await res.json()) as {
          problems: string[]
          difficulties?: Record<string, string>
          titles?: Record<string, string>
          hasStory?: Record<string, boolean>
        }
        const { problems } = body
        if (!live) return
        // The easiest problem is the default where tiers are known, rather than
        // whichever slug happens to sort first alphabetically.
        const difficulties = body.difficulties ?? {}
        setState({
          loading: false,
          problems,
          difficulties,
          titles: body.titles ?? {},
          hasStory: body.hasStory ?? {},
          // The behavioural track defaults to no selection, which means the
          // interviewer chooses — being told the competency removes the
          // recognition the question bank opens by teaching. The other tracks
          // have no such default and pick their easiest.
          selected: track === 'mock' ? '' : easiest(problems, difficulties),
          failure: null,
        })
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

/**
 * Which editing modes this instance accepts.
 *
 * Defaults to both, and stays there if the request fails. A picker that renders
 * a *narrower* set than the server would accept loses a mode silently; one that
 * offers a mode that turns out to be refused costs a 400 on the way into a
 * drill. Of the two, the visible failure is the better one.
 */
function useEditors(): ('browser' | 'own')[] {
  const [editors, setEditors] = useState<('browser' | 'own')[]>(['browser', 'own'])
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch('/api/instance')
        if (!res.ok) return
        const body = (await res.json()) as { editors?: ('browser' | 'own')[] }
        if (live && Array.isArray(body.editors) && body.editors.length > 0) setEditors(body.editors)
      } catch (error) {
        console.error('voice: /api/instance unreachable', error)
      }
    })()
    return () => {
      live = false
    }
  }, [])
  return editors
}

/**
 * The one line of record on this screen: cold solves, and when you last drilled.
 *
 * Cold rather than total, for the reason `local/drill-log.md`'s own preamble
 * gives and the history screen repeats — "a solve that took four hints is a
 * different fact from a cold solve". A landing page that opened with a flattered
 * number would be the first place that flattening happened.
 *
 * Failure is silent here, and only here: this is a decoration on a page whose
 * job is starting a drill. The history screen says so loudly because there the
 * log *is* the content.
 */
function useRecord(): { cold: number; attempts: number; lastDrill: string | null } | null {
  const [record, setRecord] = useState<{ cold: number; attempts: number; lastDrill: string | null } | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch('/api/history')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = (await res.json()) as HistoryPayload
        if (!live || payload.summary.attempts === 0) return
        // ISO dates, so lexical max is chronological max. Taking the last row
        // would assume the log is append-ordered, which it is by convention but
        // not by construction — rows get hand-edited.
        const dates = payload.rows.map((row) => row.date).filter((date) => date !== '')
        setRecord({
          cold: payload.summary.cold,
          attempts: payload.summary.attempts,
          lastDrill: dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null,
        })
      } catch {
        // Deliberately silent — see above.
      }
    })()
    return () => {
      live = false
    }
  }, [])

  return record
}

interface TrackRowProps {
  name: string
  /** `45 min · timed` / `Untimed · not scored`. The commitment, before the prose. */
  meta: string
  blurb: string
  list: ProblemList
  offline: boolean
  buttonLabel: string
  /** Only the coding row is filled: it is the primary track and the page should say so once. */
  primary?: boolean
  onStart(problem: string): void
  /**
   * Extra controls rendered under the select, inside column 3. Only the coding
   * row uses this — the editing-mode picker — so it is optional rather than
   * adding a track-specific prop to every other row.
   */
  extra?: ReactNode
  /**
   * Render the select and button for a track whose choice is *optional*, where
   * an empty selection is a real answer rather than "nothing picked yet".
   */
  optional?: boolean
  children?: ReactNode
}

/**
 * One track: what it is, what it costs you, what you are drilling, and go.
 *
 * The four columns are fixed at `210px 1fr 300px 200px` so that every row's
 * select starts at the same x and every button ends at the same one. That
 * alignment is the whole reason this is a table and not a list — the controls
 * are what you are comparing, and ragged controls made the page read as six
 * unrelated widgets.
 */
function TrackRow({ name, meta, blurb, list, offline, buttonLabel, primary, onStart, extra, optional, children }: TrackRowProps) {
  const [selected, setSelected] = useState('')
  // The list arrives asynchronously, so the default cannot be an initial value.
  const chosen = selected || list.selected
  const id = `home-problem-${name.replace(/\s+/g, '-').toLowerCase()}`
  const groups = groupByTier(list.problems, list.difficulties)
  // A server that answered badly. The offline case is covered by the banner
  // above the table, and claiming one track is the casualty would be untrue.
  const unavailable = list.failure === 'route'

  return (
    <div className="track-row" data-unavailable={unavailable ? '' : undefined}>
      <div className="track-row__id">
        <span className="track-row__name">{name}</span>
        <span className="track-row__meta">{meta}</span>
      </div>

      <p className="track-row__blurb">{blurb}</p>

      <div className="track-row__choose">
        <Select
          value={optional ? (selected === '' ? INTERVIEWERS_CHOICE : selected) : chosen === '' ? undefined : chosen}
          disabled={!optional && list.problems.length === 0}
          onValueChange={(value) =>
            optional ? setSelected(value === INTERVIEWERS_CHOICE ? '' : value) : setSelected(value)
          }
        >
          <SelectTrigger id={id} className="track-row__select" aria-busy={list.loading} aria-label={`${name} problem`}>
            <SelectValue placeholder={list.loading ? 'Loading…' : list.failure ? 'Unavailable' : 'None found'} />
          </SelectTrigger>
          <SelectContent>
            {/* Always first and always available, including while the list loads
                or after it fails: an unreachable competency list must not be able
                to block the drill that does not need one. */}
            {optional && <SelectItem value={INTERVIEWERS_CHOICE}>Interviewer&rsquo;s choice</SelectItem>}
            {groups && !optional
              ? groups.map((group) => (
                  <SelectGroup key={group.label}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {group.problems.map((problem) => (
                      <SelectItem key={problem} value={problem}>
                        {list.titles[problem] ?? problem}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))
              : list.problems.map((problem) => (
                  <SelectItem key={problem} value={problem}>
                    {/* A title when the track sends one — the debugging track
                        sends the bug report's headline, which is what makes its
                        picker readable. Design and coding send none, so they show
                        slugs exactly as before. */}
                    {list.titles[problem] ?? problem}
                    {optional && list.hasStory[problem] === false ? ' — no story yet' : ''}
                  </SelectItem>
                ))}
          </SelectContent>
        </Select>

        {extra}
        {children}

        {unavailable && (
          <p className="track-row__unavailable">
            The server could not list these — this track is unavailable. The others do not use this list.
          </p>
        )}
      </div>

      <div className="track-row__go">
        <Button
          variant={primary ? 'brand' : 'outline'}
          disabled={offline || unavailable || list.loading || (!optional && chosen === '')}
          onClick={() => onStart(optional ? selected : chosen)}
        >
          {list.loading ? 'Loading…' : buttonLabel}
        </Button>
      </div>
    </div>
  )
}

/**
 * Where the coding drill's answer gets written.
 *
 * A `RadioGroup` rather than two `Checkbox`es, though it lives in the same
 * design-system family: the two modes are mutually exclusive, and a pair of
 * checkboxes can be both-on or both-off — neither of which is a drill anyone can
 * start. Radix enforces the exclusivity and the roving-focus keyboard behaviour
 * that a hand-rolled pair of inputs does not have.
 *
 * Both options are named with their trade-off rather than just their location,
 * because the choice is not a preference — the modes rehearse different things.
 * See AGENTS.md, "Two editing modes".
 */
/**
 * Two words each.
 *
 * These used to carry their whole trade-off in the label — "an interview
 * screen: highlighting and line numbers, no type checking" — on the reasoning
 * that the modes rehearse different things and the choice is not a preference.
 * That reasoning is sound and the label was still the wrong place for it: it is
 * read every single time the picker is opened, by someone who has known the
 * difference since the first time. The trade-off lives in AGENTS.md, which is
 * where a thing you need once belongs.
 */
const EDITOR_OPTIONS = [
  { value: 'browser', id: 'editor-browser', label: 'Browser' },
  { value: 'own', id: 'editor-own', label: 'My own editor' },
] as const

function EditorChoice({ value, onChange }: { value: 'browser' | 'own'; onChange(next: 'browser' | 'own'): void }) {
  return (
    <fieldset className="m-0 flex min-w-0 items-center gap-x-4 border-0 p-0">
      <legend className="sr-only">Where are you writing this</legend>
      {/* One row now that the labels are two words. Stacking them was a
          consequence of labels long enough to wrap, not a decision. */}
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as 'browser' | 'own')}
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
      >
        {EDITOR_OPTIONS.map((option) => (
          // `htmlFor`/`id` rather than wrapping the control in the label: Radix
          // renders the item as a button, and a button inside a label swallows
          // the click that is meant to select it.
          <div key={option.value} className="flex items-center gap-x-2">
            <RadioGroupItem value={option.value} id={option.id} />
            {/* Deliberately not Brutalkit's `Label`, which is
                `text-xs uppercase tracking-wide` — built for a field name like
                "EMAIL". The control comes from the design system; the wording
                is ours. */}
            <label
              htmlFor={option.id}
              className={`cursor-pointer text-[13px] leading-none ${
                value === option.value ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {option.label}
            </label>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  )
}

export function Home({ onChoose }: Props) {
  const design = useProblems('design')
  const coding = useProblems('coding')
  const mock = useProblems('mock')
  const coach = useProblems('coach')
  const debug = useProblems('debug')
  const assisted = useProblems('assisted')
  const record = useRecord()
  const editors = useEditors()
  // Where the coding drill's answer gets written — see AGENTS.md, "Two editing
  // modes". Defaults to the browser editor: it is the mode that most resembles
  // an actual interview screen, so it is what a first-time visitor sees.
  const [editor, setEditor] = useState<'browser' | 'own'>('browser')
  // `browser` is both the default and the only option a deployed instance
  // accepts, so nothing has to reconcile a stale `own` here when the list
  // arrives — the state simply never leaves `browser` on a server that never
  // offers the control that sets it.

  // Any list failing to reach the server means the server is not there.
  const offline =
    design.failure === 'offline' ||
    coding.failure === 'offline' ||
    mock.failure === 'offline' ||
    coach.failure === 'offline' ||
    debug.failure === 'offline' ||
    assisted.failure === 'offline'

  return (
    <main className="home">
      <div className="home__inner">
        <div className="home__head">
          <h1 className="home__title">What are we drilling?</h1>
          {record !== null && (
            <Button variant="link" className="home__record" onClick={() => onChoose({ view: 'history' })}>
              {record.cold} of {record.attempts} solved cold
              {record.lastDrill !== null && ` · last drill ${record.lastDrill}`}
            </Button>
          )}
        </div>

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

        <div className="home__tracks">
          <TrackRow
            name="Behavioral"
            meta="Untimed · critiqued"
            blurb="One question, cold. Silence does not end a turn — thinking time is the exercise."
            list={mock}
            offline={offline}
            buttonLabel="Behavioral drill"
            optional
            onStart={(competency) => onChoose(competency ? { view: 'mock', competency } : { view: 'mock' })}
          />

          <TrackRow
            name="System design"
            meta="45 min · timed"
            blurb="The prompt stays on screen the whole way. Scored against the rubric at time."
            list={design}
            offline={offline}
            buttonLabel="Design drill"
            onStart={(problem) => onChoose({ view: 'design', problem })}
          />

          <TrackRow
            name="Coding"
            meta="45 min · timed"
            blurb="Talk through it as you go. Hints are rationed: one ask buys exactly one rung."
            list={coding}
            offline={offline}
            buttonLabel="Coding drill"
            primary
            onStart={(problem) => onChoose({ view: 'coding', problem, editor })}
            // No control at all when there is nothing to choose between, rather
            // than a disabled one or a single stuck radio. A one-option choice
            // reads as a setting that might do something and is the kind of
            // thing someone clicks at twice before concluding the page is
            // broken. On a deployed instance the browser editor is simply how
            // it works, and a picker should not narrate an absent alternative.
            extra={
              editors.includes('own') ? (
                <EditorChoice value={editor} onChange={setEditor} />
              ) : undefined
            }
          />

          <TrackRow
            name="Debugging"
            // 45, matching DEBUG_BUDGET_MS server-side. The blurb has always said
            // forty-five minutes; the client's timed check was what disagreed.
            meta="45 min · timed"
            blurb="A bug report for code you did not write. Say what you think is happening before you change anything — a fix that greens the symptom while the invariant stays red is reported as a symptom patch."
            list={debug}
            offline={offline}
            buttonLabel="Debugging round"
            onStart={(problem) => onChoose({ view: 'debug', problem })}
          />

          <TrackRow
            name="AI-assisted"
            meta="60 min · timed"
            // The one track where help is unlimited on purpose, so the blurb has to
            // say what is being scored instead — otherwise it reads as the coding
            // drill with the difficulty turned down, which is the opposite of true.
            blurb="Bring your own agent — nothing is rationed. Scored on whether you framed it, verified it and can defend it, not on recall."
            list={assisted}
            offline={offline}
            buttonLabel="Assisted round"
            onStart={(problem) => onChoose({ view: 'assisted', problem })}
          />

          {/* Below the drills for the same reason Pairing is: it is help, and
              help chosen before you start is a different decision from help
              reached for while stuck. Practice reuses the coding problem set —
              the same problems, with the interview taken off them. */}
          <TrackRow
            name="Practice"
            meta="Untimed · nothing recorded"
            blurb="Just the editor and the tests, with a tutor you can ask anything. No interviewer, no clock, no hint ladder — and nothing written to your record, so it costs nothing to abandon."
            list={coding}
            offline={offline}
            buttonLabel="Practice"
            onStart={(problem) => onChoose({ view: 'practice', problem })}
          />

          {/* Last, and deliberately below the drills. A coaching link on the drill
              screen is exactly the leak the hint ladder exists to prevent —
              starting one has to be a decision made before you begin, not an
              escape hatch reachable while you are stuck. */}
          <TrackRow
            name="Pairing"
            meta="Untimed · not scored"
            blurb="Not an interview. The coach has the worked solution and answers straight. Use it after a drill, not instead of one."
            list={coach}
            offline={offline}
            buttonLabel="Start pairing"
            onStart={(problem) => onChoose({ view: 'coach', problem })}
          />
        </div>

        {/* Not a track, so not a row: nothing starts here. The record line at the
            top is the other way in, for when you land already knowing you want to
            look rather than drill. */}
        <div className="home__foot">
          <span className="home__note">What you have attempted, whether it landed, and what help it took.</span>
          <Button variant="outline" onClick={() => onChoose({ view: 'history' })}>
            Past drills
          </Button>
        </div>
      </div>
    </main>
  )
}
