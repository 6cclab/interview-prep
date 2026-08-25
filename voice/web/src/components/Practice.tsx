import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'brutalkit/button';
import type { DrillVerdict } from '../../../drill-verdict';
import { runExerciseInBrowser } from '../testRunner/clientVerdict';
import type { RunLog } from '../testRunner/types';
import { usePracticeChat, type ChatSend } from '../usePracticeChat';
import { Markdown } from './Markdown';
import { Workbench, WorkbenchEditor } from './Workbench';
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
  return (
    <div className={`practice-verdict ${tone}`}>
      <p>{correctness ? 'Wrong answer.' : 'Right answer, too expensive.'}</p>
      <ul>
        {verdict.failed.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
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

      <Workbench problem={problem} track="coding">
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
              painting dark text on a dark panel. */}
          <Button
            type="button"
            className="workbench__btn"
            variant="outline"
            onClick={onRun}
            disabled={running}
            aria-busy={running}
          >
            {running ? 'Running…' : 'Run tests'}
          </Button>
          {verdict && <VerdictLine verdict={verdict} />}
        </div>

        {/* Where the transcript sits on a drill. Same slot, same scrolling, for
            the thing that plays the same part: the conversation about the code
            you are writing, with the test output above it because output is
            what most questions are about. */}
        <div className="practice-pane">
          {logs.length > 0 && <RunOutput logs={logs} />}

          <section className="practice-chat" aria-label="Ask the tutor">
            <h2 className="workbench__label">Ask</h2>
            <div className="practice-chat-log" role="log" aria-live="polite">
              {chat.messages.length === 0 && (
                <p className="practice-chat-empty">
                  Ask anything about this problem — what it is asking for, why a
                  test is failing, or how an approach works.
                </p>
              )}
              {chat.messages.map((message, index) => (
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
                </div>
              ))}
            </div>
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
                <Button type="button" variant="outline" onClick={chat.stop}>
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={question.trim() === ''}
                >
                  Ask
                </Button>
              )}
            </form>
          </section>
        </div>
      </Workbench>
    </div>
  );
}
