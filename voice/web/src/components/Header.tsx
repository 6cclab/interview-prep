import { Button } from 'brutalkit/button'
import { fmt } from '../phase'

interface Props {
  sessionSeconds: number
  dark: boolean
  onToggleTheme(): void
  micCheckOpen: boolean
  onToggleMicCheck(): void
}

// The handoff's "States" button (header, right) is the prototype's own
// review affordance and must not ship — see the handoff's Overview. This
// slot is repurposed for the one diagnostic this app keeps for real:
// MicCheck (see App.tsx), toggled as a collapsible disclosure rather than a
// permanent fixture, so it never competes with the single-screen layout it
// was carved out of.
export function Header({ sessionSeconds, dark, onToggleTheme, micCheckOpen, onToggleMicCheck }: Props) {
  return (
    <header className="app-header">
      <div className="app-header__title">
        <span className="app-header__name">Mock interview</span>
        <span className="app-header__kicker">Behavioral · voice</span>
      </div>
      <div className="app-header__actions">
        <span className="app-header__clock">{fmt(sessionSeconds)} session</span>
        <Button variant="ghost" size="sm" onClick={onToggleTheme} aria-label="Toggle light and dark theme">
          {dark ? 'Light' : 'Dark'}
        </Button>
        <Button variant="outline" size="sm" onClick={onToggleMicCheck} aria-expanded={micCheckOpen}>
          Mic check
        </Button>
      </div>
    </header>
  )
}
