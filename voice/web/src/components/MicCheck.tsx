import { useCallback, useState } from 'react'

/**
 * An in-page microphone diagnostic.
 *
 * This exists because the failure it diagnoses is invisible from the outside:
 * `getUserMedia` can neither resolve nor reject, and when that happens the
 * only evidence lives in the browser's own console — which means asking the
 * person trying to *use* the drill to act as a debugger. This runs the same
 * three checks and puts the answers on screen.
 *
 * It reports facts and never changes session state, so it is safe to run at
 * any point, including mid-drill.
 */

interface Check {
  label: string
  detail: string
  state: 'ok' | 'warn' | 'bad' | 'pending'
}

const GRANT_HINT =
  'Permission is per-origin, so a different port counts as a different site. ' +
  'Check chrome://settings/content/microphone for this exact origin, and ' +
  'System Settings → Privacy & Security → Microphone for the browser itself.'

// Long enough that a genuinely slow grant isn't reported as a hang, short
// enough to beat the person's patience. The real promise is left running.
const HANG_MS = 6000

async function runChecks(push: (check: Check) => void): Promise<void> {
  push({ label: 'Secure context', detail: String(window.isSecureContext), state: window.isSecureContext ? 'ok' : 'bad' })

  const hasMediaDevices = typeof navigator !== 'undefined' && navigator.mediaDevices !== undefined
  push({
    label: 'navigator.mediaDevices',
    detail: hasMediaDevices ? 'present' : 'missing — the browser exposes no capture API here',
    state: hasMediaDevices ? 'ok' : 'bad',
  })
  if (!hasMediaDevices) return

  // `navigator.permissions` predates the microphone descriptor in some
  // browsers, and Firefox rejects the query outright rather than returning
  // 'prompt'. An unavailable answer is not a failure.
  try {
    const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    push({
      label: 'Permission state',
      detail: permission.state,
      state: permission.state === 'granted' ? 'ok' : permission.state === 'denied' ? 'bad' : 'warn',
    })
  } catch {
    push({ label: 'Permission state', detail: 'not reportable in this browser', state: 'warn' })
  }

  // Before a grant, browsers hide device labels but still list the devices.
  // So an entry with an empty label means "a mic exists, but you have no
  // permission yet" — which distinguishes a missing grant from missing
  // hardware, two failures that look identical from the UI.
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const inputs = devices.filter((d) => d.kind === 'audioinput')
    const named = inputs.filter((d) => d.label !== '').length
    push({
      label: 'Audio inputs',
      detail:
        inputs.length === 0
          ? 'none found — the browser sees no microphone at all'
          : `${inputs.length} found, ${named} with names${named === 0 ? ' (names are hidden until access is granted)' : ''}`,
      state: inputs.length === 0 ? 'bad' : named === 0 ? 'warn' : 'ok',
    })
  } catch (error) {
    push({ label: 'Audio inputs', detail: `could not enumerate: ${describe(error)}`, state: 'bad' })
  }

  push({ label: 'getUserMedia', detail: 'waiting for the browser…', state: 'pending' })

  let settled = false
  const hang = setTimeout(() => {
    if (settled) return
    push({
      label: 'getUserMedia',
      detail: `no answer after ${HANG_MS / 1000}s — the browser is neither granting nor refusing. ${GRANT_HINT}`,
      state: 'bad',
    })
  }, HANG_MS)

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    settled = true
    clearTimeout(hang)
    const track = stream.getAudioTracks()[0]
    push({
      label: 'getUserMedia',
      detail: `granted — capturing from "${track?.label ?? 'unknown device'}"`,
      state: 'ok',
    })
    // Release immediately: this is a probe, and holding the device would
    // make the drill's own acquisition contend with it.
    for (const t of stream.getTracks()) t.stop()
  } catch (error) {
    settled = true
    clearTimeout(hang)
    push({ label: 'getUserMedia', detail: `${describe(error)}. ${GRANT_HINT}`, state: 'bad' })
  }
}

function describe(error: unknown): string {
  if (error instanceof DOMException) return `${error.name}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

export function MicCheck() {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [running, setRunning] = useState(false)

  const run = useCallback((): void => {
    setChecks([])
    setRunning(true)
    // Replaces an earlier result for the same label so the pending
    // `getUserMedia` row resolves in place rather than appearing twice.
    const push = (check: Check): void =>
      setChecks((prev) => [...(prev ?? []).filter((c) => c.label !== check.label), check])
    void runChecks(push).finally(() => setRunning(false))
  }, [])

  return (
    <section className="mic-check" aria-label="Microphone diagnostic">
      <button type="button" className="mic-check__run" onClick={run} disabled={running}>
        {running ? 'Checking microphone…' : 'Check microphone'}
      </button>

      {checks && checks.length > 0 && (
        <dl className="mic-check__results" aria-live="polite">
          {checks.map((check) => (
            <div key={check.label} className="mic-check__row" data-state={check.state}>
              <dt>{check.label}</dt>
              <dd>{check.detail}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
