import { useEffect, useRef, useState } from 'react'

// The drill's pacing target: roughly two minutes is on target, past four is
// too long. These are display thresholds only — nothing here can stop or
// affect the recording; see the comment on the interval that drives
// `elapsedSeconds` in useVoiceSession.ts.
const TARGET_SECONDS = 120
const OVER_SECONDS = 240
// The bar's visual scale caps here so the target/over marks stay legible
// instead of being squeezed toward one end as an answer runs very long.
const BAR_SCALE_SECONDS = 300

type Zone = 'good' | 'warn' | 'over'

function zoneFor(seconds: number): Zone {
  if (seconds < TARGET_SECONDS) return 'good'
  if (seconds < OVER_SECONDS) return 'warn'
  return 'over'
}

const ZONE_ANNOUNCEMENT: Record<Zone, string> = {
  good: 'Answer length: within target.',
  warn: 'Answer length: running long.',
  over: 'Answer length: over time — consider wrapping up.',
}

function format(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function ElapsedReadout({ seconds }: { seconds: number }) {
  const zone = zoneFor(seconds)
  const previousZone = useRef<Zone>('good')
  const [announcement, setAnnouncement] = useState('')

  // Announce zone *transitions* only, not the ticking clock — a live region
  // that spoke every second would be unusable noise for a screen reader.
  useEffect(() => {
    if (zone !== previousZone.current) {
      previousZone.current = zone
      setAnnouncement(ZONE_ANNOUNCEMENT[zone])
    }
  }, [zone])

  const fillPct = Math.min(100, (seconds / BAR_SCALE_SECONDS) * 100)
  const targetPct = (TARGET_SECONDS / BAR_SCALE_SECONDS) * 100
  const overPct = (OVER_SECONDS / BAR_SCALE_SECONDS) * 100

  return (
    <div className={`elapsed elapsed--${zone}`}>
      <div className="elapsed__row">
        <span className="elapsed__time" aria-hidden="true">
          {format(seconds)}
        </span>
        <span className="elapsed__zone-label" aria-hidden="true">
          {zone === 'good' && 'On pace'}
          {zone === 'warn' && 'Running long'}
          {zone === 'over' && 'Over time'}
        </span>
      </div>
      <div
        className="elapsed__bar"
        aria-hidden="true"
        title={`Target ~${format(TARGET_SECONDS)}, over ${format(OVER_SECONDS)}`}
      >
        <div className="elapsed__fill" style={{ width: `${fillPct}%` }} />
        <div className="elapsed__mark elapsed__mark--target" style={{ left: `${targetPct}%` }} />
        <div className="elapsed__mark elapsed__mark--over" style={{ left: `${overPct}%` }} />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  )
}
