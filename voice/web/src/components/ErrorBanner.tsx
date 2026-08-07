interface Action {
  label: string
  onClick(): void
}

interface Props {
  message: string
  action?: Action
}

// Errors are first-class: every one of them says what happened and gives a
// way out, rather than the silent dead ends that made the previous UI
// unusable. `role="alert"` makes this an assertive live region on its own,
// so it's announced the instant it appears without a separate aria-live wire-up.
export function ErrorBanner({ message, action }: Props) {
  return (
    <div className="error-banner" role="alert">
      <svg className="error-banner__icon" aria-hidden="true" viewBox="0 0 20 20" width="20" height="20">
        <path
          fill="currentColor"
          d="M10 1.5 19 17.5H1L10 1.5Zm0 5.5a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0V8a1 1 0 0 0-1-1Zm0 8a1.15 1.15 0 1 0 0-2.3 1.15 1.15 0 0 0 0 2.3Z"
        />
      </svg>
      <p className="error-banner__message">{message}</p>
      {action && (
        <button type="button" className="error-banner__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
