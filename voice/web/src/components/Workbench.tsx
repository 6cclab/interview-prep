import type { ReactNode } from 'react';
import type { ProblemTrack } from '../types';
import { ProblemColumn } from './ProblemColumn';
import { useSplit } from '../useSplit';

/**
 * The shape every screen where you read a problem and write code against it.
 *
 * Full bleed, two panes, a 1px divider: the statement on the left in a column
 * that scrolls itself, the work on the right. No page padding, no cards, no
 * drop shadows — this is a working surface, and the chrome is borders rather
 * than boxes so nothing competes with the code for attention.
 *
 * It is a component rather than a convention because the alternative was
 * tried. Practice was written as its own three-column grid of bordered cards
 * with 24px of page padding, on the reasoning that a drill and a practice
 * session "genuinely differ" — the drill has a transcript and a clock, practice
 * has a tutor. They differ in what fills the right pane. They do not differ in
 * being the same screen, and building the second one from scratch produced a
 * page in a different design language that happened to contain the same parts.
 *
 * So: the layout is here, once. What goes in the main pane is the caller's.
 */
interface Props {
  problem: string;
  /** Which statement the column fetches, or null for a track that shows none. */
  track: ProblemTrack | null;
  /** The centre pane: editor, toolbar, and whatever sits under them. */
  children: ReactNode;
  /**
   * A third column on the right, or nothing.
   *
   * Present, the workbench narrows the problem column to make room — three
   * columns out of a fixed 560px plus a fixed aside leaves the editor with
   * whatever is left over, which at 1200px is 280px and unusable. So the two
   * outer columns become fluid and the centre keeps the remainder, which is
   * the right priority: the statement and the conversation are prose and read
   * fine narrower, the code is the thing being worked on.
   */
  aside?: ReactNode;
}

export function Workbench({ problem, track, children, aside }: Props) {
  // The aside's width, on the same terms as the editor's height: a preference,
  // not a constant. It was `clamp(300px, 24vw, 400px)`, which is a reasonable
  // guess at "enough for prose" and the wrong answer whenever you are reading a
  // long explanation or, the other way, want the code wider while you type.
  const split = useSplit('aside', { axis: 'horizontal' });
  return (
    <div
      className={aside ? 'workbench workbench--three' : 'workbench'}
      ref={aside ? split.containerRef : undefined}
      data-dragging={aside && split.dragging ? '' : undefined}
    >
      {track !== null && (
        <ProblemColumn
          problem={problem}
          track={track}
          className="workbench__problem"
        />
      )}
      <main className="workbench__main">{children}</main>
      {aside && (
        <>
          {/* Same control as the horizontal one, turned ninety degrees: a real
              separator with a range, focusable, arrow keys, double-click to
              restore. The only difference is which rect coordinate the drag
              reads — see `useSplit`. */}
          <div
            className="workbench__divider workbench__divider--v"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the tutor column"
            aria-valuenow={Math.round(split.fraction * 100)}
            aria-valuemin={Math.round(split.limits.min * 100)}
            aria-valuemax={Math.round(split.limits.max * 100)}
            tabIndex={0}
            onPointerDown={split.onPointerDown}
            onKeyDown={split.onKeyDown}
            onDoubleClick={split.reset}
          />
          <aside
            className="workbench__aside"
            style={{ flexBasis: `${split.fraction * 100}%` }}
          >
            {aside}
          </aside>
        </>
      )}
    </div>
  );
}

/**
 * The editor, a draggable divider, and the pane under it.
 *
 * The editor was a fixed 352px with the pane below taking everything left over,
 * which on the practice screen put a sixteen-line editor under a test pane with
 * room for forty lines of nothing. Now the editor takes the column and the pane
 * below gets a share of it that can be dragged — because how much output you
 * want on screen depends on the problem and on whether the suite is red, which
 * is a preference and not a constant.
 *
 * `label` and the editor's children are passed rather than the caller composing
 * the editor itself, because the three parts have to be siblings in one flex
 * column for the fraction to mean anything: a wrapper around the editor would
 * resolve the percentage against the wrapper instead of the column. That
 * replaced a `WorkbenchEditor` export, rather than sitting beside it — two ways
 * to build the same pane is how the drill and practice drifted apart the first
 * time.
 *
 * `toolbar` sits between them, fixed, and is deliberately *above* the divider —
 * it acts on the code, so it belongs to the editor half, and a toolbar that
 * moved when you resized the output would read as part of the output.
 */
export function WorkbenchSplit({
  storageKey,
  defaultFraction,
  label,
  toolbar,
  children,
  lower
}: {
  /** Which screen's preference this is. Separate keys, separate memories. */
  storageKey: string;
  /** The lower pane's share before anything is dragged. */
  defaultFraction?: number;
  label: ReactNode;
  children: ReactNode;
  toolbar?: ReactNode;
  lower: ReactNode;
}) {
  const split = useSplit(storageKey, { initial: defaultFraction });
  return (
    <div
      className="workbench__split"
      ref={split.containerRef}
      data-dragging={split.dragging ? '' : undefined}
    >
      <div className="workbench__editor">
        <WorkbenchHead>{label}</WorkbenchHead>
        <div className="workbench__cm">{children}</div>
      </div>
      {toolbar}
      {/*
        `separator` with a value, not a bare div: this is a real control with a
        real range, and a screen reader that announces it as a group with no
        value tells someone nothing about what dragging it would do. Focusable
        so the arrow keys in `onKeyDown` can be reached at all — a divider that
        needs a mouse is unusable on the one screen most likely to be driven
        from the keyboard.

        Double-click restores the default. Dragging the output to nothing and
        wanting it back is the common mistake, and hunting for a 7px strip is a
        poor way to fix it.
      */}
      <div
        className="workbench__divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the editor"
        aria-valuenow={Math.round(split.fraction * 100)}
        aria-valuemin={Math.round(split.limits.min * 100)}
        aria-valuemax={Math.round(split.limits.max * 100)}
        tabIndex={0}
        onPointerDown={split.onPointerDown}
        onKeyDown={split.onKeyDown}
        onDoubleClick={split.reset}
      />
      <div className="workbench__lower" style={{ flexBasis: `${split.fraction * 100}%` }}>
        {lower}
      </div>
    </div>
  );
}

/**
 * A pane's 30px label bar — `SOLUTION.TS`, `ASK`, `OUTPUT`.
 *
 * Its own export so the aside and the output section get the *same* bar as the
 * editor rather than a second definition of one. The practice screen had two
 * such definitions before this, at 12.5px/0.1em against the bar's
 * 10.5px/0.14em, which is the kind of drift nobody sees and everybody feels.
 */
export function WorkbenchHead({ children }: { children: ReactNode }) {
  return <div className="workbench__head workbench__label">{children}</div>;
}
