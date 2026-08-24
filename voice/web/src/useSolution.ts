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
  /** Replaces the buffer outright — only `reloadFromServer` calls this. */
  setText: (text: string) => void
  getVersion: () => string
  setVersion: (version: string) => void
  isDirty: () => boolean
  setDirty: (dirty: boolean) => void
  setStatus: (status: SolutionStatus) => void
  /**
   * True from a 409 until an explicit `overwriteConflict` or
   * `reloadFromServer` resolves it. See `createAutosave`'s `attempt`: while
   * this is true, autosave refuses to send anything at all, rather than
   * resolving the conflict on its own by racing a stale-version save
   * against the fresh one — that would be the same silent data loss the 409
   * guard exists to prevent, just pointed the other way.
   */
  isConflicted: () => boolean
  setConflicted: (conflicted: boolean) => void
}

/**
 * Builds the re-entrancy-safe `save()` the hook exposes: one attempt of the
 * existing save logic (dirty check, status transitions, the 409 distinction),
 * wrapped in `createSaveGate` so overlapping calls coalesce instead of racing.
 *
 * A 409 now does two things a plain "keep the buffer" used to stop short of:
 * it records the server's current version (`setVersion`), so a later explicit
 * `overwriteConflict` has something correct to send, and it flags
 * `setConflicted(true)`, so every *automatic* save attempt after that —
 * another debounce tick, another `Run tests` force-save — is refused before
 * it ever reaches the network, rather than resending the same doomed version
 * forever. Only `overwriteConflict` and `reloadFromServer` clear the flag.
 */
export function createAutosave(
  slug: string,
  state: AutosaveState,
  fetchImpl: typeof fetch = fetch,
): () => Promise<SaveResult['kind']> {
  const attempt = async (): Promise<SaveResult['kind']> => {
    // Suspended: a conflict is a decision for the user (Overwrite/Reload),
    // never something autosave resolves on its own. No network call at all —
    // this is what stops the 409-forever loop the trap used to cause.
    if (state.isConflicted()) return 'stale'
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
      // Keep the buffer. Refresh the version so Overwrite has something
      // correct to send, and suspend further autosaves until the user
      // chooses. See the interface comment on `isConflicted`.
      state.setVersion(result.version)
      state.setConflicted(true)
      state.setStatus('conflict')
    } else {
      state.setStatus('error')
    }
    return result.kind
  }
  return createSaveGate(attempt)
}

/**
 * The conflict banner's "Overwrite" action: saves the local buffer using the
 * version a prior 409 already refreshed (`state.getVersion()`), bypassing
 * `isConflicted`'s suspension deliberately — this is the one save the user
 * asked for by name, not autosave resolving itself.
 *
 * If someone wrote *again* in the meantime, the server 409s a second time;
 * this stays in `conflict` (with the newer version recorded) rather than
 * pretending to have succeeded.
 */
export async function overwriteConflict(
  slug: string,
  state: AutosaveState,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveResult['kind']> {
  const textAtStart = state.getText()
  state.setStatus('saving')
  const result = await saveSolution(slug, textAtStart, state.getVersion(), fetchImpl)
  if (result.kind === 'ok') {
    state.setVersion(result.version)
    state.setConflicted(false)
    if (state.getText() === textAtStart) {
      state.setDirty(false)
    }
    state.setStatus('idle')
  } else if (result.kind === 'stale') {
    state.setVersion(result.version)
    state.setConflicted(true)
    state.setStatus('conflict')
  } else {
    state.setStatus('error')
  }
  return result.kind
}

/**
 * The conflict banner's "Reload" action: discards the local buffer and
 * replaces it with the server's copy. The one action here that is allowed to
 * throw away typed text — its label says so, plainly, per the finding this
 * fixes.
 */
export async function reloadFromServer(
  slug: string,
  state: AutosaveState,
  fetchImpl: typeof fetch = fetch,
): Promise<'ok' | 'error'> {
  try {
    const res = await fetchImpl(`/api/coding/${slug}/solution`)
    if (!res.ok) {
      state.setStatus('error')
      return 'error'
    }
    const body = (await res.json()) as { text: string; version: string }
    state.setText(body.text)
    state.setVersion(body.version)
    state.setDirty(false)
    state.setConflicted(false)
    state.setStatus('idle')
    return 'ok'
  } catch {
    state.setStatus('error')
    return 'error'
  }
}

export function useSolution(slug: string, enabled: boolean) {
  const [text, setTextState] = useState('')
  const [status, setStatus] = useState<SolutionStatus>('loading')
  const version = useRef('')
  const dirty = useRef(false)
  const textRef = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // See `AutosaveState.isConflicted`. Set by `createAutosave`'s `attempt` on
  // a 409, cleared only by `overwrite`/`reload` below.
  const conflicted = useRef(false)

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
  const autosaveRef = useRef<
    { slug: string; accessors: AutosaveState; save: () => Promise<SaveResult['kind']> } | undefined
  >(undefined)
  if (autosaveRef.current?.slug !== slug) {
    const accessors: AutosaveState = {
      getText: () => textRef.current,
      setText: (v) => { textRef.current = v; setTextState(v) },
      getVersion: () => version.current,
      setVersion: (v) => { version.current = v },
      isDirty: () => dirty.current,
      setDirty: (v) => { dirty.current = v },
      setStatus,
      isConflicted: () => conflicted.current,
      setConflicted: (v) => { conflicted.current = v },
    }
    autosaveRef.current = { slug, accessors, save: createAutosave(slug, accessors) }
  }

  const save = useCallback((): Promise<SaveResult['kind']> => {
    clearTimeout(timer.current)
    return autosaveRef.current!.save()
  }, [])

  // The conflict banner's "Overwrite": save the local buffer using the
  // version the 409 already refreshed, then resume normal autosaving.
  const overwrite = useCallback((): Promise<SaveResult['kind']> => {
    clearTimeout(timer.current)
    return overwriteConflict(slug, autosaveRef.current!.accessors)
  }, [slug])

  // The conflict banner's "Reload": discard the local buffer for the
  // server's copy, then resume normal autosaving.
  const reload = useCallback((): Promise<'ok' | 'error'> => {
    clearTimeout(timer.current)
    return reloadFromServer(slug, autosaveRef.current!.accessors)
  }, [slug])

  const setText = useCallback((next: string) => {
    dirty.current = true
    textRef.current = next
    setTextState(next)
  }, [])

  // Debounced autosave. Suspended while conflicted — see `isConflicted` — so
  // typing during an unresolved conflict does not silently fire a save the
  // user never asked for; `createAutosave`'s own check would refuse it
  // anyway, but skipping the timer here also stops it hitting the network
  // guard on every keystroke for nothing.
  useEffect(() => {
    if (!enabled || !dirty.current || conflicted.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), AUTOSAVE_IDLE_MS)
    return () => clearTimeout(timer.current)
  }, [text, enabled, save])

  // Best-effort save on unmount and on `beforeunload` — the design promises
  // saving on blur, and nothing implemented that; without this, an edit made
  // inside the ~1s debounce window is lost silently if the tab closes or the
  // route unmounts before the timer fires. One handler covers both exits,
  // the same shape as `useVoiceSession`'s own `beforeunload` handler
  // (`navigator.sendBeacon` — the only mechanism that can still deliver a
  // request after the page has started tearing down). `sendBeacon` is
  // POST-only, so `voice/http-server.ts`'s solution route accepts POST as an
  // alias for PUT for exactly this caller.
  //
  // Skipped while conflicted: sending the buffer here would be the same
  // unasked-for overwrite `isConflicted` exists to prevent, just triggered by
  // a tab close instead of a debounce tick. Losing at most the last second of
  // typing in that specific case is the honest trade — the conflict already
  // means someone else's write is on disk and the candidate has not chosen
  // what to do about it.
  useEffect(() => {
    if (!enabled) return
    const flush = () => {
      if (!dirty.current || conflicted.current) return
      const payload = JSON.stringify({ text: textRef.current, version: version.current })
      navigator.sendBeacon(`/api/coding/${slug}/solution`, new Blob([payload], { type: 'application/json' }))
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [slug, enabled])

  return { text, setText, save, overwrite, reload, status }
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
