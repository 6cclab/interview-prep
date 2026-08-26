import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A draggable divider between two panes of the workbench.
 *
 * Two of them exist. The horizontal one sits between the editor and whatever is
 * under it — test output on the practice screen, the transcript on a drill —
 * and the vertical one between the centre column and the tutor.
 *
 * Both were fixed: a 352px editor with the pane below taking everything left
 * over, and a `clamp(300px, 24vw, 400px)` aside. Neither proportion is a
 * constant. How much output you want on screen depends on the problem and on
 * whether the suite is red; how much tutor you want depends on whether you are
 * reading an explanation or writing code. Those are working preferences, and
 * they are his to set.
 *
 * The state is always **the fraction given to the far pane** — the lower one,
 * or the right one — never a pixel size. A pixel size is wrong across a window
 * resize and wrong across two monitors; a fraction survives both. It is also
 * the number the requirement was stated in: "the test output should only take
 * about 10-20% of vertical height".
 */

/** Which way the divider moves. `vertical` splits top from bottom. */
export type SplitAxis = 'vertical' | 'horizontal'

export interface SplitLimits {
  min: number
  max: number
  fallback: number
}

/**
 * How small each pane may get, per axis.
 *
 * The floor is never zero: a divider you can drag until the pane it reveals has
 * no height is a divider that loses that pane, with no affordance to get it
 * back other than finding the same 7px strip again. The ceiling is the same
 * rule in the other direction — this is an IDE, and one whose editor can be
 * dragged shut is not one.
 *
 * The two axes differ because the panes do. A test pane is useful at a tenth of
 * the column and pointless at three-quarters; a tutor column is unreadable
 * below about a sixth of the width, since it holds prose and code blocks rather
 * than a list of test names.
 */
export const VERTICAL: SplitLimits = { min: 0.08, max: 0.8, fallback: 0.18 }
export const HORIZONTAL: SplitLimits = { min: 0.15, max: 0.5, fallback: 0.24 }

export function limitsFor(axis: SplitAxis): SplitLimits {
  return axis === 'vertical' ? VERTICAL : HORIZONTAL
}

export function clampFraction(value: number, limits: SplitLimits = VERTICAL): number {
  if (!Number.isFinite(value)) return limits.fallback
  return Math.min(limits.max, Math.max(limits.min, value))
}

/**
 * The far pane's fraction implied by a pointer at `position`.
 *
 * Axis-agnostic: pass `top`/`height`/`clientY` for a horizontal divider and
 * `left`/`width`/`clientX` for a vertical one. Both measure the share *beyond*
 * the pointer, which is the pane being sized in each case.
 *
 * Reads off the container's own rect rather than accumulating deltas from where
 * the drag began. Accumulated deltas drift: every clamp at a limit throws away
 * the overshoot, so dragging past the floor and back leaves the divider offset
 * from the cursor by however far it was pushed, and nothing re-syncs them.
 */
export function fractionFromPointer(
  start: number,
  size: number,
  position: number,
  limits: SplitLimits = VERTICAL,
): number {
  if (size <= 0) return limits.fallback
  return clampFraction((size - (position - start)) / size, limits)
}

const PREFIX = 'workbench:split:'

/**
 * The stored fraction for a divider, or the fallback.
 *
 * Anything unreadable — absent, not a number, out of range, private browsing
 * throwing on the read — yields the fallback rather than propagating. A layout
 * preference is the last thing that should stop a screen rendering.
 */
export function readStoredFraction(
  key: string,
  storage?: Storage,
  limits: SplitLimits = VERTICAL,
): number {
  try {
    const raw = (storage ?? window.localStorage).getItem(PREFIX + key)
    if (raw === null) return limits.fallback
    const parsed = Number(raw)
    // Out of range is treated as absent, not clamped into range: a value
    // outside the limits was written by a different version of these limits,
    // and honouring it would silently reintroduce whatever they used to allow.
    if (!Number.isFinite(parsed) || parsed < limits.min || parsed > limits.max) {
      return limits.fallback
    }
    return parsed
  } catch {
    return limits.fallback
  }
}

export function storeFraction(key: string, fraction: number, storage?: Storage): void {
  try {
    ;(storage ?? window.localStorage).setItem(PREFIX + key, String(fraction))
  } catch {
    /* private browsing, or a full quota. A lost preference is not worth a throw. */
  }
}

/** How far one arrow-key press moves the divider. */
export const KEY_STEP = 0.02

/**
 * The keyboard equivalent of a drag, or null for a key this does not handle.
 *
 * A separator that only responds to a pointer cannot be used without a mouse,
 * and these sit on the screen someone is most likely to be driving from the
 * keyboard. The mapping follows the divider, not the pane: the key points the
 * way the line moves. Up and Left grow the near pane, Down and Right grow the
 * far one.
 *
 * Null rather than the current value, so the caller knows not to
 * `preventDefault` — swallowing Tab would trap focus on the divider.
 */
export function fractionForKey(
  key: string,
  current: number,
  axis: SplitAxis = 'vertical',
): number | null {
  const limits = limitsFor(axis)
  const [less, more] = axis === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowRight', 'ArrowLeft']
  switch (key) {
    case less:
      return clampFraction(current - KEY_STEP, limits)
    case more:
      return clampFraction(current + KEY_STEP, limits)
    case 'Home':
      return limits.min
    case 'End':
      return limits.max
    default:
      return null
  }
}

export interface Split {
  /** The far pane's share of the container, 0–1. */
  fraction: number
  /** Attach to the element the two panes divide — the drag reads its rect. */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** True while a drag is in progress, for the cursor and the selection lock. */
  dragging: boolean
  limits: SplitLimits
  onPointerDown(event: React.PointerEvent): void
  onKeyDown(event: React.KeyboardEvent): void
  /** Back to the default, for a double-click on the divider. */
  reset(): void
}

export function useSplit(
  key: string,
  { axis = 'vertical', initial }: { axis?: SplitAxis; initial?: number } = {},
): Split {
  const limits = limitsFor(axis)
  const start = initial ?? limits.fallback
  // Read lazily, in the initialiser, so the stored value is on screen for the
  // first paint rather than applied by an effect a frame later — which reads as
  // the layout jumping every time the screen opens.
  const [fraction, setFraction] = useState(() => {
    const stored = readStoredFraction(key, undefined, limits)
    return stored === limits.fallback ? clampFraction(start, limits) : stored
  })
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const apply = useCallback(
    (next: number) => {
      setFraction(next)
      storeFraction(key, next)
    },
    [key],
  )

  // Listeners on `window`, not on the divider. A pointer moving faster than the
  // divider follows leaves the element behind, and a `pointermove` bound to the
  // element simply stops firing — the drag dies mid-gesture and the divider is
  // left wherever the cursor last happened to be over it.
  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent): void => {
      const box = containerRef.current?.getBoundingClientRect()
      if (!box) return
      setFraction(
        axis === 'vertical'
          ? fractionFromPointer(box.top, box.height, event.clientY, limits)
          : fractionFromPointer(box.left, box.width, event.clientX, limits),
      )
    }
    const up = (): void => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    // A drag that ends outside the window never fires `pointerup`; without this
    // the divider stays glued to the cursor after the button is released.
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [axis, dragging, limits])

  // Written once at the end of a drag rather than on every `pointermove`:
  // localStorage is synchronous, and writing it sixty times a second competes
  // with the layout the drag is trying to update.
  useEffect(() => {
    if (dragging) return
    storeFraction(key, fraction)
  }, [dragging, fraction, key])

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    // Left button only, and stop the browser from starting a text selection
    // that would paint the whole column blue for the length of the drag.
    if (event.button !== 0) return
    event.preventDefault()
    setDragging(true)
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const next = fractionForKey(event.key, fraction, axis)
      if (next === null) return
      event.preventDefault()
      apply(next)
    },
    [apply, axis, fraction],
  )

  const reset = useCallback(() => apply(clampFraction(start, limits)), [apply, limits, start])

  return { fraction, containerRef, dragging, limits, onPointerDown, onKeyDown, reset }
}
