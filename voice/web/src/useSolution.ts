import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveResult =
  | { kind: 'ok'; version: string }
  /** The file changed underneath us. Keep the buffer; the user decides. */
  | { kind: 'stale'; version: string }
  | { kind: 'error' }

/**
 * One save round-trip.
 *
 * Split out of the hook so the outcome mapping — especially that a 409 is its
 * own kind and not an error — is testable without a renderer. A client that
 * retried a 409 would eventually win the race, which is precisely the data loss
 * the server-side guard exists to prevent.
 */
export async function saveSolution(
  slug: string,
  text: string,
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
  try {
    const res = await fetchImpl(`/api/coding/${slug}/solution`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, version }),
    })
    const body = (await res.json().catch(() => ({}))) as { version?: unknown }
    if (res.status === 200 && typeof body.version === 'string') {
      return { kind: 'ok', version: body.version }
    }
    if (res.status === 409 && typeof body.version === 'string') {
      return { kind: 'stale', version: body.version }
    }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export type SolutionStatus = 'loading' | 'idle' | 'saving' | 'conflict' | 'error'

const AUTOSAVE_IDLE_MS = 1000

export function useSolution(slug: string, enabled: boolean) {
  const [text, setTextState] = useState('')
  const [status, setStatus] = useState<SolutionStatus>('loading')
  const version = useRef('')
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/coding/${slug}/solution`)
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as { text: string; version: string }
        if (cancelled) return
        version.current = body.version
        setTextState(body.text)
        setStatus('idle')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug, enabled])

  const save = useCallback(async (): Promise<SaveResult['kind']> => {
    clearTimeout(timer.current)
    if (!dirty.current) return 'ok'
    setStatus('saving')
    const result = await saveSolution(slug, text, version.current)
    if (result.kind === 'ok') {
      version.current = result.version
      dirty.current = false
      setStatus('idle')
    } else if (result.kind === 'stale') {
      // Keep the buffer. The user is told the file moved and chooses.
      setStatus('conflict')
    } else {
      setStatus('error')
    }
    return result.kind
  }, [slug, text])

  const setText = useCallback((next: string) => {
    dirty.current = true
    setTextState(next)
  }, [])

  // Debounced autosave.
  useEffect(() => {
    if (!enabled || !dirty.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), AUTOSAVE_IDLE_MS)
    return () => clearTimeout(timer.current)
  }, [text, enabled, save])

  return { text, setText, save, status }
}

/**
 * Save first, then run — and do not run at all if the save did not land.
 *
 * A verdict computed against stale text is a verdict for code the candidate
 * can see they did not write, and the verdict is the single signal a drill
 * produces. Running anyway would be worse than not running: it looks like an
 * answer.
 *
 * In `own` mode there is nothing to save; the candidate's editor already wrote
 * the file.
 */
export async function runAfterSave(
  mode: 'browser' | 'own' | undefined,
  save: () => Promise<SaveResult['kind']>,
  run: () => Promise<void>,
): Promise<'ran' | 'blocked'> {
  if (mode === 'browser') {
    const outcome = await save()
    if (outcome !== 'ok') return 'blocked'
  }
  await run()
  return 'ran'
}
