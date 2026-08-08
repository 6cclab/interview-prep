interface Props {
  announcement: string
  alertText: string
}

// Two visually-hidden live regions, per the handoff: polite for state
// changes, assertive for errors. Clipped rather than `display: none` so
// screen readers still pick up text changes.
export function LiveRegions({ announcement, alertText }: Props) {
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div role="alert" aria-live="assertive" className="sr-only">
        {alertText}
      </div>
    </>
  )
}
