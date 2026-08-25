import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'brutalkit/button';
import { groupFailures, type DrillVerdict } from '../../../drill-verdict';
import { runExerciseInBrowser } from '../testRunner/clientVerdict';
import type { RunLog } from '../testRunner/types';
import { usePracticeChat, type ChatSend } from '../usePracticeChat';
import { Markdown } from './Markdown';
import { Workbench, WorkbenchEditor, WorkbenchHead } from './Workbench';
import { SolutionEditor } from './SolutionEditor';

/**
 * Practice: the editor, the suite, and a tutor.
 *
 * Not a drill screen, and deliberately not a variant of one. There is no
 * interviewer, no session, no clock, no hint ladder and no record — so none of
 * `useVoiceSession`'s machinery is here, and nothing on this screen can start a
 * session. It is the one mode you can leave halfway through and lose nothing,
 * because there was nothing being kept.
 */

/** Where a practice buffer lives. Never the drill's `solution.ts` — see `load`. */
function storageKey(slug: string): string {
  return `practice:${slug}`;
}

/**
 * The buffer, in `localStorage`, and *not* through `useSolution`.
 *
 * `useSolution` writes to `/api/coding/:slug/solution`, which locally is the
 * real `problems/<pattern>/<slug>/solution.ts` and deployed is the row a coding
 * drill reads back. Practising a problem would therefore overwrite the attempt
 * you are mid-way through on the same problem — silently, with no undo, from a
 * mode whose entire premise is that it keeps no record and costs nothing to
 * abandon.
 *
 * So practice keeps its own scratch buffer, per browser. Losing it costs a
 * practice session; sharing the drill's would cost an attempt.
 */
function load(slug: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(slug));
  } catch {
    // Private browsing, or storage disabled. Practice still works — it just
    // starts from the stub each time, which is a worse session and not a broken
    // one.
    return null;
  }
}

function save(slug: string, code: string): void {
  try {
    window.localStorage.setItem(storageKey(slug), code);
  } catch {
    /* see `load` */
  }
}

/**
 * The verdict as one line, for the toolbar.
 *
 * The toolbar is a fixed strip that stays put while the pane below it scrolls,
 * so this has to stay one line whatever happened — a seven-item failure list
 * lived here once and grew the strip until it pushed the editor around and
 * collided with the output. The list moved to `FailureList`, in the pane. What
 * belongs here is the answer to "what happened", visible without scrolling.
 */
function VerdictLine({ verdict }: { verdict: DrillVerdict }) {
  if (verdict.kind === 'green') {
    return (
      <p className="practice-verdict practice-verdict--green">
        All tests passed.
      </p>
    );
  }
  if (verdict.kind === 'errored') {
    return (
      <p className="practice-verdict practice-verdict--errored">
        {verdict.message}
      </p>
    );
  }
  // The two reds are kept apart here for the same reason the whole repo keeps
  // them apart: a wrong answer and a correct-but-too-slow answer call for
  // opposite next moves, and collapsing them into "tests failed" is the one
  // mistake that makes the suite actively misleading.
  const correctness = verdict.kind === 'correctness-red';
  // Written out rather than interpolated, and that is not style. A class name
  // built from a template literal cannot be found by grepping for the class,
  // which is precisely how three stylesheet rules in this app came to target
  // names nothing emitted. `styles-are-live.test.ts` reads this file as text.
  const tone = correctness
    ? 'practice-verdict--wrong'
    : 'practice-verdict--cost';
  const count = verdict.failed.length;
  return (
    <p className={`practice-verdict ${tone}`}>
      {correctness ? 'Wrong answer.' : 'Right answer, too expensive.'}{' '}
      <span className="practice-verdict-count">
        {count} {count === 1 ? 'test' : 'tests'} failed
      </span>
    </p>
  );
}

/**
 * Which tests failed, with the suite said once.
 *
 * Every name arrives as `<suite> > <title>`, and on a single-suite problem that
 * meant seven rows each opening with the same thirty characters — the part that
 * distinguishes them pushed to the right, past where the eye starts. The suite
 * is a heading now and the rows are just the titles, which is the same shape
 * vitest itself prints and for the same reason.
 *
 * `groupFailures` comes from `drill-verdict.ts`, next to the join it inverts,
 * so the delimiter keeps exactly one owner.
 */
function FailureList({ verdict }: { verdict: DrillVerdict }) {
  if (verdict.kind !== 'correctness-red' && verdict.kind !== 'cost-red')
    return null;
  const tone =
    verdict.kind === 'correctness-red'
      ? 'practice-failures practice-failures--wrong'
      : 'practice-failures practice-failures--cost';
  return (
    <section className={tone} aria-label="Failing tests">
      <h2 className="workbench__label">Failing</h2>
      {groupFailures(verdict.failed).map((group, index) => (
        <div key={index} className="practice-failure-group">
          {group.suite !== '' && (
            <p className="practice-failure-suite">{group.suite}</p>
          )}
          <ul>
            {group.titles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * What the candidate's code printed, grouped by the test that was running.
 *
 * Grouped rather than a flat stream because the same line printed from inside
 * six different tests is six different facts, and a flat log makes them look
 * like one loop. Vitest groups the same way, for the same reason.
 *
 * Only rendered when there is something to show: an empty "Output" heading on
 * every run trains you to ignore the area where the output will be.
 */
function RunOutput({ logs }: { logs: RunLog[] }) {
  const groups: { test: string; lines: RunLog[] }[] = [];
  for (const line of logs) {
    const last = groups.at(-1);
    if (last && last.test === line.test) last.lines.push(line);
    else groups.push({ test: line.test, lines: [line] });
  }
  return (
    <section className="practice-output" aria-label="Console output">
      <h2 className="workbench__label">Output</h2>
      {groups.map((group, index) => (
        <div key={index} className="practice-output-group">
          {group.test !== '' && (
            <p className="practice-output-test">{group.test}</p>
          )}
          <pre className="practice-output-lines">
            {group.lines.map((line, lineIndex) => (
              <span
                key={lineIndex}
                className={
                  line.level === 'error'
                    ? 'practice-output-line practice-output-line--error'
                    : line.level === 'warn'
                      ? 'practice-output-line practice-output-line--warn'
                      : 'practice-output-line'
                }
              >
                {line.text}
                {'\n'}
              </span>
            ))}
          </pre>
        </div>
      ))}
    </section>
  );
}

interface Props {
  problem: string;
  onGoHome(): void;
  dark: boolean;
  onToggleTheme(): void;
  /** Test seams. The screen is otherwise untestable without a Worker and a server. */
  send?: ChatSend;
  runTests?: typeof runExerciseInBrowser;
}

export function Practice({
  problem,
  onGoHome,
  dark,
  onToggleTheme,
  send,
  runTests = runExerciseInBrowser
}: Props) {
  const [code, setCode] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [verdict, setVerdict] = useState<DrillVerdict | null>(null);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [running, setRunning] = useState(false);
  const [question, setQuestion] = useState('');

  // Read at send time rather than captured, so the tutor is asked about the
  // buffer as it is now and not as it was when the handler was created.
  const codeRef = useRef('');
  codeRef.current = code;
  const chat = usePracticeChat(problem, () => codeRef.current, send);

  // The stub seeds an empty buffer and nothing else. A saved buffer always wins:
  // re-seeding from the stub on every visit would silently discard work.
  useEffect(() => {
    let cancelled = false;
    const saved = load(problem);
    if (saved !== null) {
      setCode(saved);
      setLoaded(true);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/coding/${problem}/exercise`);
        if (!res.ok) throw new Error('no exercise');
        const body = (await res.json()) as { stub: string };
        if (!cancelled) setCode(body.stub);
      } catch {
        // An empty editor is a worse start than a stub and still a usable one.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [problem]);

  const onChange = useCallback(
    (next: string) => {
      setCode(next);
      save(problem, next);
    },
    [problem]
  );

  const onRun = useCallback(() => {
    if (running) return;
    setRunning(true);
    // Cleared rather than left showing: a stale green above a running suite
    // reads as the new run having passed already.
    setVerdict(null);
    setLogs([]);
    void (async () => {
      try {
        const run = await runTests(problem, codeRef.current);
        setVerdict(run.verdict);
        setLogs(run.logs);
      } finally {
        setRunning(false);
      }
    })();
  }, [problem, running, runTests]);

  return (
    <div className="drill">
      {/* `.app-header`, the same header row the chooser and the drill use — its
          own component rather than the drill `Header`, which carries a session
          clock, a mic check and device settings that mean nothing here. Same
          relationship `HomeHeader` already has to it. */}
      <header className="app-header">
        <div className="app-header__title">
          <a href="/">
            <span className="app-header__name">Practice</span>
          </a>
          {/* Says what this is, because the screen is a drill screen and this is
              not a drill. Nothing here is timed, graded or written down. */}
          <span className="app-header__kicker">
            {problem} · nothing is recorded
          </span>
        </div>
        <div className="app-header__actions">
          <Button variant="ghost" size="sm" onClick={onGoHome}>
            Change drill
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleTheme}
            aria-label="Toggle light and dark theme"
          >
            {dark ? 'Light' : 'Dark'}
          </Button>
        </div>
      </header>

      <Workbench
        problem={problem}
        track="coding"
        aside={
          <section className="practice-chat" aria-label="Ask the tutor">
            <WorkbenchHead>Ask</WorkbenchHead>
            <div
              className="practice-chat-log"
              role="log"
              aria-live="polite"
              aria-busy={chat.streaming}
            >
              {chat.messages.length === 0 && (
                <p className="practice-chat-empty">
                  Ask anything about this problem — what it is asking for, why a
                  test is failing, or how an approach works.
                </p>
              )}
              {chat.messages.map((message, index) => {
                // The turn currently being answered: the last one, when it is
                // the tutor's and a reply is still in flight. `usePracticeChat`
                // puts an empty assistant turn up the moment a question is
                // sent, so without this the column shows the question and then
                // nothing at all — which reads as the send having failed, and
                // on a local model that silence can last several seconds.
                const pending =
                  chat.streaming &&
                  message.role === 'assistant' &&
                  index === chat.messages.length - 1;
                return (
                  <div
                    key={index}
                    className={
                      message.role === 'assistant'
                        ? 'practice-turn practice-turn--assistant'
                        : 'practice-turn practice-turn--user'
                    }
                  >
                    {message.role === 'assistant' ? (
                      <Markdown source={message.content} />
                    ) : (
                      <p>{message.content}</p>
                    )}
                    {pending && (
                      <p className="practice-thinking">
                        {/* Named only while there is nothing to read yet. Once
                            text is arriving the caret alone says "still going",
                            and a "Thinking" label sitting under a half-written
                            answer contradicts it. */}
                        {message.content === '' && <span>Thinking</span>}
                        <span className="workbench__caret" aria-hidden="true" />
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Pinned below the log rather than scrolling with it: the box you
                type into must not move when a reply streams in. */}
            <form
              className="practice-ask"
              onSubmit={(event) => {
                event.preventDefault();
                chat.ask(question);
                setQuestion('');
              }}
            >
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                // Enter sends, Shift+Enter breaks the line. A chat box that needs
                // a mouse to send is a chat box people stop using.
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    chat.ask(question);
                    setQuestion('');
                  }
                }}
                placeholder="Ask the tutor…"
                rows={3}
                aria-label="Your question"
              />
              {chat.streaming ? (
                <Button
                  type="button"
                  className="workbench__btn"
                  variant="outline"
                  onClick={chat.stop}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="workbench__btn"
                  variant="outline"
                  disabled={question.trim() === ''}
                >
                  Ask
                </Button>
              )}
            </form>
          </section>
        }
      >
        <WorkbenchEditor label="solution.ts">
          {loaded ? (
            <SolutionEditor value={code} onChange={onChange} />
          ) : (
            <p>Loading…</p>
          )}
        </WorkbenchEditor>

        {/* The drill's toolbar strip, in the drill's position: a bordered rule
            directly under the editor, because these act on the code. There is
            no hint ladder to ration, so the verdict takes that half of the row
            instead. */}
        <div className="workbench__toolbar">
          {/* `outline`, the same variant the drill's Run tests uses. `brand`
              was invisible here: `.workbench__btn` overrides the background to
              `--card`, which left the filled variant's on-brand foreground
              painting dark text on a dark panel.

              `primary-wait` while running: the indeterminate sweeping bar this
              app already uses for every wait that cannot report a percentage,
              added *to* the system's button rather than replacing it. A suite
              can take up to `SUITE_TIMEOUT_MS`, and for that whole time the
              only signal was a dashed border — which reads as broken, not
              busy, and is exactly what makes someone press it again. */}
          <Button
            type="button"
            className={
              running ? 'workbench__btn primary-wait' : 'workbench__btn'
            }
            variant="outline"
            onClick={onRun}
            disabled={running}
            aria-busy={running}
          >
            {running ? 'Running…' : 'Run tests'}
          </Button>
          {verdict && <VerdictLine verdict={verdict} />}
        </div>

        {/* Below the code, in the centre column: the tests are about the code
            and belong under it, not off in a side panel. Scrolls itself so a
            long run never pushes the editor up the screen. */}
        <div className="practice-pane" aria-busy={running}>
          {/* Three states, and the running one is not optional: this pane is
              where you look for the result, so leaving "Nothing run yet" up
              while a suite runs actively contradicts the button. */}
          {running ? (
            <p className="practice-pane-empty">
              Running the suite
              <span className="workbench__caret" aria-hidden="true" />
            </p>
          ) : verdict !== null || logs.length > 0 ? (
            <>
              {verdict && <FailureList verdict={verdict} />}
              {logs.length > 0 && <RunOutput logs={logs} />}
            </>
          ) : (
            <p className="practice-pane-empty">
              Nothing run yet. Press Run tests to see the suite and anything
              your code prints.
            </p>
          )}
        </div>
      </Workbench>
    </div>
  );
}
