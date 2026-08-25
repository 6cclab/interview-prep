import type { ReactNode } from 'react';
import type { ProblemTrack } from '../types';
import { ProblemColumn } from './ProblemColumn';

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
  /** The right pane: editor, toolbar, and whatever sits under them. */
  children: ReactNode;
}

export function Workbench({ problem, track, children }: Props) {
  return (
    <div className="workbench">
      {track !== null && (
        <ProblemColumn
          problem={problem}
          track={track}
          className="workbench__problem"
        />
      )}
      <main className="workbench__main">{children}</main>
    </div>
  );
}

/**
 * The editor and its label bar.
 *
 * The bar is not decoration: it is the only place the filename appears, and on
 * the drill it doubles as where autosave says it has stopped. Practice has
 * nothing to report there, so it shows the filename alone — but it shows the
 * bar, because an editor that starts at the top of a pane with no header reads
 * as a text area rather than as a file.
 */
export function WorkbenchEditor({
  label,
  children
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="workbench__editor">
      <div className="workbench__editor-head workbench__label">{label}</div>
      <div className="workbench__cm">{children}</div>
    </div>
  );
}
