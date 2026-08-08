import { Button } from 'brutalkit/button'
import { fmt } from '../phase'

interface Props {
  sessionSeconds: number
  /** Shown in place of the session clock on a timed drill — see `App.tsx`. */
  remainingSeconds: number | null
  /** The live drill's label, e.g. "System design · rate-limiter". */
  kicker: string
  dark: boolean
  onToggleTheme(): void
  micCheckOpen: boolean
  onToggleMicCheck(): void
  deviceSettingsOpen: boolean
  onToggleDeviceSettings(): void
}

// The handoff's "States" button (header, right) is the prototype's own
// review affordance and must not ship — see the handoff's Overview. This
// slot is repurposed for the diagnostics this app keeps for real: MicCheck
// and DeviceSettings (see App.tsx), each toggled as its own collapsible
// disclosure rather than a permanent fixture, so neither competes with the
// single-screen layout it was carved out of.
export function Header({
  sessionSeconds,
  remainingSeconds,
  kicker,
  dark,
  onToggleTheme,
  micCheckOpen,
  onToggleMicCheck,
  deviceSettingsOpen,
  onToggleDeviceSettings,
}: Props) {
  return (
    <header className="app-header">
      <div className="app-header__title">
        <span className="app-header__name">Mock interview</span>
        <span className="app-header__kicker">{kicker}</span>
      </div>
      <div className="app-header__actions">
        {/* A timed drill shows what remains, not what has elapsed: the number
            that matters in a 45-minute design interview is how much is left, and
            showing both would make the screen ask which one to read. `remaining`
            marks it for the pacing colour, and the label says which it is so the
            two can never be confused at a glance. */}
        {remainingSeconds === null ? (
          <span className="app-header__clock">{fmt(sessionSeconds)} session</span>
        ) : (
          <span
            className="app-header__clock app-header__clock--remaining"
            data-spent={remainingSeconds === 0 ? 'true' : undefined}
          >
            {fmt(remainingSeconds)} left
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={onToggleTheme} aria-label="Toggle light and dark theme">
          {dark ? 'Light' : 'Dark'}
        </Button>
        <Button variant="outline" size="sm" onClick={onToggleDeviceSettings} aria-expanded={deviceSettingsOpen}>
          Devices
        </Button>
        <Button variant="outline" size="sm" onClick={onToggleMicCheck} aria-expanded={micCheckOpen}>
          Mic check
        </Button>
      </div>
    </header>
  )
}
