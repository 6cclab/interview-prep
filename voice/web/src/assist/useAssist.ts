import { useEffect, useMemo, useRef } from 'react'
import type { Extension } from '@codemirror/state'
import { createAssistClient, type AssistClient, type AssistWorker } from './client'
import { assistExtensions } from './extension'

/**
 * One assist Worker for the life of one Practice screen.
 *
 * Built in a `useMemo` rather than an effect because `SolutionEditor` needs the
 * extension list at the moment it constructs its `EditorState` — an effect runs
 * after that, and the editor would spend its first render without a checker and
 * then be torn down and rebuilt to get one, losing the cursor.
 *
 * The teardown is an effect, and it is the one that matters: a Worker holding a
 * parsed copy of the standard library is not something to leak per screen
 * visit. `dispose` also rejects everything in flight, so a request issued during
 * the keystroke that navigated away settles instead of hanging.
 */
export function useAssist(
  /** Test seam — the same shape `createAssistClient` takes. */
  spawn?: () => AssistWorker,
): Extension[] {
  const client = useMemo<AssistClient>(
    () => createAssistClient(spawn),
    // Built exactly once. `spawn` is a test seam and is not expected to change;
    // rebuilding on it would discard the editor along with the Worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Held in a ref so the cleanup effect can be empty-dependency — `client` is
  // already stable, but tying the teardown to it would make a future change to
  // the memo silently start disposing the Worker mid-session.
  const held = useRef(client)
  held.current = client
  useEffect(() => () => held.current.dispose(), [])

  return useMemo(() => assistExtensions(client), [client])
}
