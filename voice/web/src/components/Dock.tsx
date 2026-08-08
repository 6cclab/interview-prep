import { Button } from 'brutalkit/button'
import type { Phase } from '../types'
import { PrimaryAction } from './PrimaryAction'

interface Props {
  phase: Phase
  statusTitle: string
  statusDetail: string
  onEndSession(): void
  onPrimary(): void
}

// Bottom dock, always visible: status block on the left, "End session" +
// the primary action on the right. The detail line is the slot that must
// absorb a full paragraph (the hung-permission copy) without shifting
// anything else — see the `max-width`/wrap rule in styles.css rather than
// any JS truncation here.
export function Dock({ phase, statusTitle, statusDetail, onEndSession, onPrimary }: Props) {
  const canEndSession = phase !== 'idle' && phase !== 'ended'

  return (
    <div className="dock">
      <div className="dock__inner">
        <div className="dock__status">
          <div className="dock__status-row">
            {phase === 'recording' && <span className="dock__dot dock__dot--recording" aria-hidden="true" />}
            {phase === 'requesting' && <span className="dock__dot dock__dot--requesting" aria-hidden="true" />}
            <span className="dock__title">{statusTitle}</span>
          </div>
          <p className="dock__detail">{statusDetail}</p>
        </div>
        <div className="dock__actions">
          {canEndSession && (
            <Button variant="outline" onClick={onEndSession}>
              End session
            </Button>
          )}
          <PrimaryAction phase={phase} onPress={onPrimary} />
        </div>
      </div>
    </div>
  )
}
