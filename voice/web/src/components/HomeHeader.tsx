import { Button } from 'brutalkit/button';

/**
 * The chooser's header. Deliberately not the drill `Header`: that one carries a
 * session clock, a mic check, device settings and a "Change drill" action, none
 * of which mean anything before a drill is chosen. Sharing it would have meant
 * making every one of those conditional on a route.
 */

interface Props {
  dark: boolean;
  onToggleTheme(): void;
}

export function HomeHeader({ dark, onToggleTheme }: Props) {
  return (
    <header className="app-header">
      <div className="app-header__title">
        <a href="/">
          <span className="app-header__name">Interview prep</span>
        </a>
        <span className="app-header__kicker">Spoken drills</span>
      </div>
      <div className="app-header__actions">
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
  );
}
