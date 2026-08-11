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

/**
 * Makes an async function safe against re-entrant calls: at most one
 * underlying call runs at a time. A call that arrives while one is already
 * in flight does not start a second one — it queues exactly one rerun for
 * after the current call settles, and every caller queued behind the same
 * in-flight call shares that rerun's result.
 *
 * This is what stops autosave's PUT from racing itself: without it, a
 * debounce firing again mid-request sends a second PUT carrying the same
 * pre-save `version`, which 409s against the version the first request just
 * advanced — a spurious "changed on disk" for a change nobody but this tab
 * made. Queuing instead of firing immediately also means the rerun, once it
 * actually executes, reads whatever is current at that point (fresh text,
 * fresh version) rather than a stale snapshot taken when it was requested.
 */
export function createSaveGate<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null
  let queued: { resolve: (v: T) => void; reject: (e: unknown) => void; promise: Promise<T> } | null = null

  function run(): Promise<T> {
    const p = fn()
    inFlight = p
    p.then(settle, settle)
    return p
  }

  function settle() {
    inFlight = null
    if (queued) {
      const next = queued
      queued = null
      run().then(next.resolve, next.reject)
    }
  }

  return function trigger(): Promise<T> {
    if (!inFlight) return run()
    if (!queued) {
      let resolve!: (v: T) => void
      let reject!: (e: unknown) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      queued = { resolve, reject, promise }
    }
    return queued.promise
  }
}

/** The mutable state one save attempt reads and writes, decoupled from React refs so it's testable without a renderer. */
export interface AutosaveState {
  getText: () => string
  getVersion: () => string
  setVersion: (version: string) => void
  isDirty: () => boolean
  setDirty: (dirty: boolean) => void
  setStatus: (status: SolutionStatus) => void
}

/**
 * Builds the re-entrancy-safe `save()` the hook exposes: one attempt of the
 * existing save logic (unchanged — dirty check, status transitions, the 409
 * distinction, never advancing `version` on a conflict), wrapped in
 * `createSaveGate` so overlapping calls coalesce instead of racing.
 */
export function createAutosave(
  slug: string,
  state: AutosaveState,
  fetchImpl: typeof fetch = fetch,
): () => Promise<SaveResult['kind']> {
  const attempt = async (): Promise<SaveResult['kind']> => {
    if (!state.isDirty()) return 'ok'
    const textAtStart = state.getText()
    state.setStatus('saving')
    const result = await saveSolution(slug, textAtStart, state.getVersion(), fetchImpl)
    if (result.kind === 'ok') {
      state.setVersion(result.version)
      // Only clear dirty if nothing was typed while this request was in
      // flight. A gated rerun already covers "call save() again mid-flight",
      // but an edit that lands with no further call behind it (nobody re-
      // triggers the debounce) must still leave the buffer dirty, or that
      // text is silently never sent.
      if (state.getText() === textAtStart) {
        state.setDirty(false)
      }
      state.setStatus('idle')
    } else if (result.kind === 'stale') {
      // Keep the buffer. The user is told the file moved and chooses.
      state.setStatus('conflict')
    } else {
      state.setStatus('error')
    }
    return result.kind
  }
  return createSaveGate(attempt)
}

export function useSolution(slug: string, enabled: boolean) {
  const [text, setTextState] = useState('')
  const [status, setStatus] = useState<SolutionStatus>('loading')
  const version = useRef('')
  const dirty = useRef(false)
  const textRef = useRef('')
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
        textRef.current = body.text
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

  // The gated save is rebuilt only when the slug changes (a different file
  // entirely) — not on every keystroke — so an in-flight save's guard state
  // survives the edits that happen while it's out on the wire. It reads
  // `textRef`/`version`/`dirty` rather than closed-over `text`, which is what
  // lets a rerun queued mid-save pick up whatever was typed most recently.
  const autosaveRef = useRef<{ slug: string; save: () => Promise<SaveResult['kind']> } | undefined>(undefined)
  if (autosaveRef.current?.slug !== slug) {
    autosaveRef.current = {
      slug,
      save: createAutosave(slug, {
        getText: () => textRef.current,
        getVersion: () => version.current,
        setVersion: (v) => { version.current = v },
        isDirty: () => dirty.current,
        setDirty: (v) => { dirty.current = v },
        setStatus,
      }),
    }
  }

  const save = useCallback((): Promise<SaveResult['kind']> => {
    clearTimeout(timer.current)
    return autosaveRef.current!.save()
  }, [])

  const setText = useCallback((next: string) => {
    dirty.current = true
    textRef.current = next
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
