import { fmt } from '../phase'

interface Props {
  /** Seconds since the current recording started. Never resets mid-turn, never counts down. */
  seconds: number
}

// The bar's visual scale caps at 5:00 so the target/threshold marks stay
// legible instead of being squeezed toward one end on a very long answer.
const BAR_SCALE_SECONDS = 300

type Zone = 'warming' | 'zone' | 'wrapping' | 'long'

function zoneFor(seconds: number): Zone {
  if (seconds < 60) return 'warming'
  if (seconds < 180) return 'zone'
  if (seconds < 240) return 'wrapping'
  return 'long'
}

const ZONE_LABEL: Record<Zone, string> = {
  warming: 'Warming up',
  zone: 'In the zone',
  wrapping: 'Wrapping up',
  long: 'Running long',
}

// No voice-activity detection, no auto-stop, no silence timer, no countdown:
// this bar only ever grows. Past 5:00 it simply sits full — see the
// hard-constraint comment on `record`/`stopAndSubmit` in useVoiceSession.ts.
export function PacingBar({ seconds }: Props) {
  const zone = zoneFor(seconds)
  const pct = Math.min(100, (seconds / BAR_SCALE_SECONDS) * 100)

  return (
    <div className="pacing" data-zone={zone}>
      <div className="pacing__row">
        <span className="pacing__zone">{ZONE_LABEL[zone]}</span>
        <span className="pacing__clock">
          {fmt(seconds)}
          {zone === 'long' ? ' · long' : ''}
        </span>
      </div>
      <div className="pacing__track">
        <div className="pacing__fill" style={{ width: `${pct}%` }} />
        <span className="pacing__mark" style={{ left: '20%' }} aria-hidden="true" />
        <span className="pacing__mark pacing__mark--target" style={{ left: '40%' }} aria-hidden="true" />
        <span className="pacing__mark" style={{ left: '60%' }} aria-hidden="true" />
        <span className="pacing__mark" style={{ left: '80%' }} aria-hidden="true" />
      </div>
      <div className="pacing__footer">
        <span>Nothing ends your turn but you. Pauses are fine.</span>
        <span>Aim for the mark at 2:00</span>
      </div>
    </div>
  )
}
