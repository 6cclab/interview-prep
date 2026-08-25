import { Button } from 'brutalkit/button'
/**
 * The toolbar under the editor: run the suite, spend a rung, read the cost.
 *
 * The hint ladder is the only place ochre appears outside a live microphone —
 * spent help and spent breath are the two metered things on this screen, and
 * giving them the same colour is the point rather than a coincidence.
 *
 * The button is deliberately quieter than `Run tests` and never grows or
 * brightens to invite a click. The cost of the next rung is written into its
 * label so it is read *before* the click rather than discovered after it, which
 * is the whole reason the ladder is rationed at all.
 */

const MAX_RUNG = 4

interface Props {
  /** How many rungs have been spent, 0-4. Server-counted; the client never guesses it. */
  hintRung: number
  /** True while a hint request is in flight, so a second click cannot spend two rungs. */
  hintPending: boolean
  running: boolean
  onRun?: () => void
  onHint?: () => void
  /**
   * Whether help is rationed at all. The pairing track shows `Run tests` and
   * omits the ladder entirely rather than disabling it: a greyed-out
   * "Ask for a hint" advertises a cost that does not exist there.
   */
  rationed: boolean
  /** The debugging track's ladder runs out after the first rung — past it the interviewer has nothing to ration. */
  hintsExhausted?: boolean
  runLabel?: string
}

function counterText(hintRung: number): string {
  if (hintRung === 0) return `Hints: 0 of ${MAX_RUNG} — no help taken`
  if (hintRung >= MAX_RUNG) return `Hints: ${MAX_RUNG} of ${MAX_RUNG} — the ladder is spent`
  return `Hints: ${hintRung} of ${MAX_RUNG}`
}

function hintLabel(hintRung: number, exhausted: boolean): string {
  if (exhausted || hintRung >= MAX_RUNG) return 'No rungs left'
  const next = hintRung + 1
  return next === MAX_RUNG
    ? `Ask for a hint — advances to rung ${next} of ${MAX_RUNG}, the last`
    : `Ask for a hint — advances to rung ${next} of ${MAX_RUNG}`
}

export function DrillToolbar({
  hintRung,
  hintPending,
  running,
  onRun,
  onHint,
  rationed,
  hintsExhausted = false,
  runLabel = 'Run tests',
}: Props) {
  const spent = hintRung > 0
  const noRungsLeft = hintsExhausted || hintRung >= MAX_RUNG

  return (
    <div className="workbench__toolbar">
      {/* `outline`, not `brand`: the design is explicit that nothing in the
          toolbar competes with the dock's primary action. The mono/uppercase
          treatment comes from `.workbench__btn`, which is now a *modifier* on the
          design system's button rather than a replacement for it. */}
      <Button type="button" variant="outline" className="workbench__btn" onClick={onRun} disabled={!onRun || running}>
        {running ? 'Running…' : runLabel}
      </Button>

      {rationed && (
        <>
          <span className="drill-toolbar__divider" aria-hidden="true" />
          <Button
            type="button"
            variant="ghost"
            className="workbench__btn drill-btn--quiet"
            onClick={onHint}
            disabled={!onHint || hintPending || noRungsLeft}
          >
            {hintPending ? 'Asking…' : hintLabel(hintRung, hintsExhausted)}
          </Button>
          <span className="drill-toolbar__spacer" />
          <span className="drill-ladder" aria-hidden="true">
            {Array.from({ length: MAX_RUNG }, (_, i) => (
              <span key={i} data-spent={i < hintRung ? '' : undefined} />
            ))}
          </span>
          <span className="drill-hint-count workbench__label" data-spent={spent ? '' : undefined}>
            {counterText(hintRung)}
          </span>
        </>
      )}

      {!rationed && (
        <>
          <span className="drill-toolbar__spacer" />
          <span className="drill-hint-count workbench__label">Nothing is rationed here — ask out loud</span>
        </>
      )}
    </div>
  )
}
