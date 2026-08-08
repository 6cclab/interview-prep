import { Button } from 'brutalkit/button'

export interface ErrorAction {
  label: string
  variant: 'brand' | 'outline' | 'ghost'
  onClick(): void
}

interface Props {
  title: string
  body: string
  actions: ErrorAction[]
}

// Errors are never silent and never dead ends: each states what happened and
// carries at least one recovery action that genuinely does something (see
// App.tsx's `errorActions` for what each of the four real failure paths can
// and cannot offer). The title is pushed to the assertive live region by the
// caller — this component only renders it.
export function ErrorBanner({ title, body, actions }: Props) {
  return (
    <div className="error-banner">
      <div className="error-banner__rule" aria-hidden="true" />
      <div className="error-banner__content">
        <div className="error-banner__title">{title}</div>
        <p className="error-banner__body">{body}</p>
        <div className="error-banner__actions">
          {actions.map((action) => (
            <Button key={action.label} variant={action.variant} size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
