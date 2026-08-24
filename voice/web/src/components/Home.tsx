import { useEffect, useState, type ReactNode } from 'react';
import { Button } from 'brutalkit/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from 'brutalkit/select';
import type { Route } from '../route';
import type { ProblemTrack } from '../types';
import { easiest, groupByTier } from '../tiers';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from 'brutalkit/card';

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
  onChoose(route: Route): void;
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
type ListFailure = 'offline' | 'route' | null;

/**
 * The behavioural picker's "let the interviewer choose" entry, which is the
 * *absence* of a competency.
 *
 * A sentinel rather than `''` because Radix — which Brutalkit's `Select` is built
 * on — reserves the empty string for clearing a selection and throws if an item
 * carries it. The empty string is still what leaves this component: it is what
 * `onStart` treats as no competency, so the sentinel never reaches a route.
 */
const INTERVIEWERS_CHOICE = 'interviewers-choice';

interface ProblemList {
  /**
   * Whether the fetch is still in flight.
   *
   * Needed because "no problems" and "not yet asked" both looked like an empty
   * array, and the picker rendered the empty case — so a slow list said "None
   * found", which is a claim rather than a wait.
   */
  loading: boolean;
  problems: string[];
  /**
   * Slug to tier, for the tracks that report one. Empty for the design track,
   * which has no difficulty field, and empty for a coding server too old to send
   * one — in both cases the picker falls back to a flat list.
   */
  difficulties: Record<string, string>;
  /** Slug to display name. Only the behavioural track sends these — a competency's title is prose, not a slug. */
  titles: Record<string, string>;
  /** Slug to whether `local/stories.md` has a story for it. Behavioural only; a competency with none is the gap. */
  hasStory: Record<string, boolean>;
  selected: string;
  failure: ListFailure;
}

const EMPTY: ProblemList = {
  loading: false,
  problems: [],
  difficulties: {},
  titles: {},
  hasStory: {},
  selected: '',
  failure: null
};

const LOADING: ProblemList = { ...EMPTY, loading: true };

/**
 * One track's problem list, fetched once.
 *
 * Per track rather than one shared fetch, because the two lists fail
 * independently: `system-design/` being unreadable says nothing about
 * `problems/`, and a single combined failure state would black out a track that
 * is perfectly fine.
 */
function useProblems(track: ProblemTrack): ProblemList {
  const [state, setState] = useState<ProblemList>(LOADING);

  useEffect(() => {
    let live = true;
    // Re-entered whenever `track` changes, so this resets rather than leaving the
    // previous track's list on screen under a new heading.
    setState(LOADING);
    void (async () => {
      let res: Response;
      try {
        res = await fetch(`/api/problems?track=${track}`);
      } catch (error) {
        // `fetch` rejects only when the request could not be made at all.
        if (live) setState({ ...EMPTY, failure: 'offline' });
        // Logged, not swallowed: a silent catch here is what made diagnosing
        // this state a spelunking exercise instead of reading the console.
        console.error(`voice: /api/problems?track=${track} unreachable`, error);
        return;
      }
      try {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          problems: string[];
          difficulties?: Record<string, string>;
          titles?: Record<string, string>;
          hasStory?: Record<string, boolean>;
        };
        const { problems } = body;
        if (!live) return;
        // The easiest problem is the default where tiers are known, rather than
        // whichever slug happens to sort first alphabetically.
        const difficulties = body.difficulties ?? {};
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
          failure: null
        });
      } catch (error) {
        if (live) setState({ ...EMPTY, failure: 'route' });
        console.error(
          `voice: /api/problems?track=${track} returned something unusable`,
          error
        );
      }
    })();
    return () => {
      live = false;
    };
  }, [track]);

  return state;
}

interface TrackCardProps {
  title: string;
  blurb: string;
  list: ProblemList;
  offline: boolean;
  buttonLabel: string;
  onStart(problem: string): void;
  /**
   * Extra controls rendered below the problem row, before the failure note.
   * Only the coding card uses this — the editing-mode picker — so it is
   * optional rather than adding a track-specific prop to every other card.
   */
  extra?: ReactNode;
}

/** A track that is chosen along with a problem — design and coding both are. */
function ProblemTrackCard({
  title,
  blurb,
  list,
  offline,
  buttonLabel,
  onStart,
  extra
}: TrackCardProps) {
  const [selected, setSelected] = useState('');
  // The list arrives asynchronously, so the default cannot be an initial value.
  const chosen = selected || list.selected;
  const id = `home-problem-${title.replace(/\s+/g, '-').toLowerCase()}`;
  const groups = groupByTier(list.problems, list.difficulties);

  return (
    <section className="home__card">
      <h2 className="home__card-title">{title}</h2>
      <p className="home__card-body">{blurb}</p>
      <div className="home__row">
        <label className="home__label" htmlFor={id}>
          Problem
        </label>
        <Select
          value={chosen === '' ? undefined : chosen}
          disabled={list.problems.length === 0}
          onValueChange={setSelected}
        >
          <SelectTrigger
            id={id}
            className="home__select"
            aria-busy={list.loading}
          >
            <SelectValue
              placeholder={
                list.loading
                  ? 'Loading…'
                  : list.failure
                    ? 'Unavailable'
                    : 'None found'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {groups
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
                    {/* A title when the track sends one — the debugging track sends
                        the bug report's headline, which is what makes its picker
                        readable. Design and coding send none, so they show slugs
                        exactly as before. */}
                    {list.titles[problem] ?? problem}
                  </SelectItem>
                ))}
          </SelectContent>
        </Select>
        <Button
          variant="brand"
          disabled={offline || list.loading || chosen === ''}
          onClick={() => onStart(chosen)}
        >
          {list.loading ? 'Loading…' : buttonLabel}
        </Button>
      </div>
      {extra}
      {/* Only for a server that answered badly. The offline case is covered by
          the banner above, and claiming the behavioural drill still works would
          be untrue there. */}
      {list.failure === 'route' && (
        <p className="home__note">
          The server could not list these problems, so this track is
          unavailable. The others do not use this list and still work.
        </p>
      )}
    </section>
  );
}

/**
 * The behavioural card.
 *
 * Not a `ProblemTrackCard`, because the choice here is *optional* and that card's
 * button is disabled until something is selected. The default — and the entry at
 * the top of the list — is the interviewer choosing, since
 * `behavioral/questions.md` opens by teaching how to spot the competency behind
 * unfamiliar phrasing, and a screen that names it first has removed that.
 *
 * Picking one is still worth having: it is how you drill a competency you know is
 * weak, and the list marks which have no story in `local/stories.md` yet, which is
 * the gap worth attacking first.
 */
function BehavioralCard({
  list,
  offline,
  onStart
}: {
  list: ProblemList;
  offline: boolean;
  onStart(competency: string): void;
}) {
  const [selected, setSelected] = useState('');

  return (
    <section className="home__card">
      <h2 className="home__card-title">Behavioral</h2>
      <p className="home__card-body">
        One question, cold, spoken aloud. No clock and no countdown — silence
        does not end a turn, and thinking time is the exercise. Critiqued
        against your own tone rules at the end.
      </p>
      <div className="home__row">
        <label className="home__label" htmlFor="home-competency">
          Competency
        </label>
        <Select
          value={selected === '' ? INTERVIEWERS_CHOICE : selected}
          onValueChange={(value) =>
            setSelected(value === INTERVIEWERS_CHOICE ? '' : value)
          }
        >
          <SelectTrigger
            id="home-competency"
            className="home__select"
            aria-busy={list.loading}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* Always first and always available, including while the list loads or
                after it fails: an unreachable competency list must not be able to
                block the drill that does not need one. */}
            <SelectItem value={INTERVIEWERS_CHOICE}>
              Interviewer&rsquo;s choice
            </SelectItem>
            {list.problems.map((slug) => (
              <SelectItem key={slug} value={slug}>
                {list.titles[slug] ?? slug}
                {list.hasStory[slug] === false ? ' — no story yet' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="brand"
          disabled={offline}
          onClick={() => onStart(selected)}
        >
          Behavioral drill
        </Button>
      </div>
      {selected !== '' && (
        <p className="home__note">
          Staying on one competency. The interviewer will not say which — but
          you know, so this is deliberate practice rather than a test of
          spotting it.
        </p>
      )}
      {list.failure === 'route' && (
        <p className="home__note">
          The server could not list the competencies, so only the
          interviewer&rsquo;s choice is available. The drill itself is
          unaffected.
        </p>
      )}
    </section>
  );
}

export function Home({ onChoose }: Props) {
  const design = useProblems('design');
  const coding = useProblems('coding');
  const mock = useProblems('mock');
  const coach = useProblems('coach');
  const debug = useProblems('debug');
  const assisted = useProblems('assisted');
  // Where the coding drill's answer gets written — see AGENTS.md, "Two editing
  // modes". Defaults to the browser editor: it is the mode that most resembles
  // an actual interview screen, so it is what a first-time visitor sees.
  const [editor, setEditor] = useState<'browser' | 'own'>('browser');

  // Any list failing to reach the server means the server is not there.
  const offline =
    design.failure === 'offline' ||
    coding.failure === 'offline' ||
    mock.failure === 'offline' ||
    coach.failure === 'offline' ||
    debug.failure === 'offline' ||
    assisted.failure === 'offline';

  return (
    <main className="home">
      <div className="home__inner">
        <h1 className="home__title">What are we drilling?</h1>

        {/* One banner for every track, because an unreachable server breaks all
            of them. Naming the command is the whole value of the message: the fix
            is always the same and it is not guessable from "unavailable". */}
        {offline && (
          <div className="home__offline" role="alert">
            <strong className="home__offline-title">
              The drill server is not responding.
            </strong>
            <span>
              Nothing can start until it is back — this is not specific to one
              track. Run <code>pnpm mock:web</code> in the repo, then reload
              this page.
            </span>
          </div>
        )}

        <BehavioralCard
          list={mock}
          offline={offline}
          onStart={(competency) =>
            onChoose(
              competency ? { view: 'mock', competency } : { view: 'mock' }
            )
          }
        />

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
          blurb="Forty-five minutes, spoken, timed. Talk through it as you go, and press Run tests when you want the suite run. Hints are rationed; ask for one and you get exactly one rung."
          list={coding}
          offline={offline}
          buttonLabel="Coding drill"
          onStart={(problem) => onChoose({ view: 'coding', problem, editor })}
          extra={
            /*
              Both options are named with their trade-off rather than just their
              location, because the choice is not a preference — the modes test
              different things. See AGENTS.md, "Two editing modes".
            */
            <fieldset className="home__editor-choice">
              <legend>Where are you writing this?</legend>
              <label>
                <input
                  type="radio"
                  name="editor"
                  value="browser"
                  checked={editor === 'browser'}
                  onChange={() => setEditor('browser')}
                />
                Browser editor — an interview screen: highlighting and line numbers, no type checking
              </label>
              <label>
                <input
                  type="radio"
                  name="editor"
                  value="own"
                  checked={editor === 'own'}
                  onChange={() => setEditor('own')}
                />
                My own editor — edit solution.ts yourself, with real types
              </label>
            </fieldset>
          }
        />

        <ProblemTrackCard
          title="Debugging"
          blurb="Forty-five minutes, spoken, timed. A bug report for code you did not write — read it in your own editor, say what you think is happening before you change anything, and run both suites when you are ready. A fix that turns the reported symptom green while the second suite stays red is a symptom patch, and it is reported as one."
          list={debug}
          offline={offline}
          buttonLabel="Debugging round"
          onStart={(problem) => onChoose({ view: 'debug', problem })}
        />

        <ProblemTrackCard
          title="AI-assisted coding"
          // The one track where help is unlimited on purpose, so the blurb has to
          // say what is being scored instead — otherwise it reads as the coding
          // drill with the difficulty turned down, which is the opposite of true.
          blurb="Sixty minutes, spoken, timed. Bring your own coding agent and use it — nothing is rationed here. You work in local/assisted/<problem>/, and the interviewer sees that directory every turn. What gets scored is whether you framed the problem before delegating it, said what you expected back before reading it, verified instead of accepting, and can defend the code when pushed. Expect spoken algorithmic questions while your tool is working."
          list={assisted}
          offline={offline}
          buttonLabel="Assisted round"
          onStart={(problem) => onChoose({ view: 'assisted', problem })}
        />

        {/* Landing page only, and deliberately below the drills. A coaching link
            on the drill screen is exactly the leak the hint ladder exists to
            prevent — starting one has to be a decision made before you begin,
            not an escape hatch reachable while you are stuck. */}
        <ProblemTrackCard
          title="Pairing"
          blurb="Not an interview. The coach has the worked solution and the pattern notes, can see your solution.ts as you type, and will answer straight — nothing is rationed and nothing is scored. Untimed. Use it after a drill, not instead of one."
          list={coach}
          offline={offline}
          buttonLabel="Start pairing"
          onStart={(problem) => onChoose({ view: 'coach', problem })}
        />

        {/* Not a track, so not a card: nothing starts here. Below the three
            choices because the question this screen asks is "what are we
            drilling", and looking at past results is the answer to a different
            one. */}
        <Card>
          <CardHeader className="w-full">
            <CardTitle>Past drills</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="home__note">
              What you have attempted, whether it landed, and what help it took.
            </span>
          </CardContent>
          <CardFooter>
            <CardAction>
              <Button
                variant="outline"
                onClick={() => onChoose({ view: 'history' })}
              >
                Past drills
              </Button>
            </CardAction>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
