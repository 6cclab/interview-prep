import { describe, expect, it } from 'vitest'
import {
  HORIZONTAL,
  KEY_STEP,
  VERTICAL,
  clampFraction,
  fractionForKey,
  fractionFromPointer,
  limitsFor,
  readStoredFraction,
  storeFraction,
} from './useSplit'

const DEFAULT_FRACTION = VERTICAL.fallback
const MIN_FRACTION = VERTICAL.min
const MAX_FRACTION = VERTICAL.max

/**
 * The arithmetic behind the divider, without a renderer.
 *
 * Everything that decides where the divider ends up is a pure function on
 * purpose; what is left in the hook is event plumbing. These are the parts that
 * can be wrong in ways nobody notices until a drag behaves oddly.
 */

describe('clampFraction', () => {
  /**
   * Neither pane may be dragged shut. A divider that can hide the thing it
   * reveals loses that pane with no affordance to get it back except finding
   * the same 7px strip again — and an IDE whose editor can be closed by
   * dragging is not one.
   */
  it('keeps both panes on screen', () => {
    expect(clampFraction(0)).toBe(MIN_FRACTION)
    expect(clampFraction(1)).toBe(MAX_FRACTION)
    expect(clampFraction(-3)).toBe(MIN_FRACTION)
  })

  it('leaves a value inside the range alone', () => {
    expect(clampFraction(0.5)).toBe(0.5)
  })

  // NaN reaches this from a division by a zero-height container, and an
  // untouched NaN becomes `flexBasis: "NaN%"`, which the browser drops — so the
  // pane silently reverts to auto height rather than showing a broken value.
  it('falls back rather than propagating a non-number', () => {
    expect(clampFraction(Number.NaN)).toBe(DEFAULT_FRACTION)
    expect(clampFraction(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FRACTION)
  })
})

describe('fractionFromPointer', () => {
  // Measured from the bottom, because the fraction describes the lower pane.
  it('reads the share below the pointer', () => {
    expect(fractionFromPointer(0, 1000, 800)).toBeCloseTo(0.2)
    expect(fractionFromPointer(0, 1000, 500)).toBeCloseTo(0.5)
  })

  it('accounts for the container not starting at the top of the window', () => {
    expect(fractionFromPointer(200, 1000, 1000)).toBeCloseTo(0.2)
  })

  /**
   * Absolute, not accumulated from where the drag began. Deltas drift: each
   * clamp at a limit throws away the overshoot, so dragging past the floor and
   * back leaves the divider offset from the cursor by however far it was
   * pushed, and nothing ever re-syncs them.
   */
  it('returns the same fraction for the same pointer, whatever came before', () => {
    expect(fractionFromPointer(0, 1000, 700)).toBe(fractionFromPointer(0, 1000, 700))
  })

  it('clamps a pointer dragged past either end', () => {
    expect(fractionFromPointer(0, 1000, 0)).toBe(MAX_FRACTION)
    expect(fractionFromPointer(0, 1000, 1000)).toBe(MIN_FRACTION)
    expect(fractionFromPointer(0, 1000, -500)).toBe(MAX_FRACTION)
  })

  // A container measured before layout has run.
  it('falls back on a container with no height', () => {
    expect(fractionFromPointer(0, 0, 100)).toBe(DEFAULT_FRACTION)
  })
})

describe('fractionForKey', () => {
  /**
   * Up grows the editor, matching the direction the divider itself moves. A
   * separator that only answers to a pointer cannot be used without a mouse —
   * on the one screen most likely to be driven from the keyboard.
   */
  it('moves the divider the way the key points', () => {
    expect(fractionForKey('ArrowUp', 0.5)).toBeCloseTo(0.5 - KEY_STEP)
    expect(fractionForKey('ArrowDown', 0.5)).toBeCloseTo(0.5 + KEY_STEP)
  })

  it('jumps to the limits', () => {
    expect(fractionForKey('Home', 0.5)).toBe(MIN_FRACTION)
    expect(fractionForKey('End', 0.5)).toBe(MAX_FRACTION)
  })

  it('stops at the limits rather than running past them', () => {
    expect(fractionForKey('ArrowUp', MIN_FRACTION)).toBe(MIN_FRACTION)
    expect(fractionForKey('ArrowDown', MAX_FRACTION)).toBe(MAX_FRACTION)
  })

  // Null rather than the current value, so the caller knows not to
  // `preventDefault` — swallowing Tab would trap focus on the divider.
  it('declines a key it does not handle', () => {
    expect(fractionForKey('Tab', 0.5)).toBeNull()
    expect(fractionForKey('a', 0.5)).toBeNull()
  })
})

describe('readStoredFraction', () => {
  function storage(initial: Record<string, string> = {}): Storage {
    const map = new Map(Object.entries(initial))
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size
      },
    } as Storage
  }

  it('round-trips through the store', () => {
    const s = storage()
    storeFraction('practice', 0.42, s)
    expect(readStoredFraction('practice', s)).toBe(0.42)
  })

  it('keeps two screens apart', () => {
    const s = storage()
    storeFraction('practice', 0.2, s)
    storeFraction('drill', 0.6, s)
    expect(readStoredFraction('practice', s)).toBe(0.2)
    expect(readStoredFraction('drill', s)).toBe(0.6)
  })

  it('defaults when nothing was ever stored', () => {
    expect(readStoredFraction('practice', storage())).toBe(DEFAULT_FRACTION)
  })

  /**
   * Out of range is treated as absent rather than clamped into range. A value
   * outside the limits was written by a different version of those limits, and
   * clamping would silently carry forward whatever they used to allow — which
   * is how a pane someone once dragged shut comes back shut.
   */
  it('ignores a value from a different set of limits', () => {
    expect(readStoredFraction('practice', storage({ 'workbench:split:practice': '0.97' }))).toBe(
      DEFAULT_FRACTION,
    )
    expect(readStoredFraction('practice', storage({ 'workbench:split:practice': '0' }))).toBe(
      DEFAULT_FRACTION,
    )
  })

  it('ignores something that is not a number at all', () => {
    expect(readStoredFraction('practice', storage({ 'workbench:split:practice': 'tall' }))).toBe(
      DEFAULT_FRACTION,
    )
  })

  /**
   * A layout preference is the last thing that should stop a screen rendering.
   * Private browsing throws on both of these.
   */
  it('survives a storage that throws', () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage
    expect(readStoredFraction('practice', hostile)).toBe(DEFAULT_FRACTION)
    expect(() => storeFraction('practice', 0.3, hostile)).not.toThrow()
  })
})

describe('the vertical divider, horizontally', () => {
  /**
   * The same function, ninety degrees round: `left`/`width`/`clientX` instead
   * of `top`/`height`/`clientY`. Both measure the share *beyond* the pointer,
   * which is the pane being sized in each case — the lower one, or the right
   * one.
   */
  it('measures the tutor column from the right edge', () => {
    expect(fractionFromPointer(0, 1000, 750, HORIZONTAL)).toBeCloseTo(0.25)
    expect(fractionFromPointer(0, 1000, 800, HORIZONTAL)).toBeCloseTo(0.2)
  })

  /**
   * Its own limits, because the panes differ. A test pane is useful at a tenth
   * of the column; a tutor column holding prose and code blocks is unreadable
   * that narrow, and there is no reason to let it eat more than half the width.
   */
  it('holds the tutor to its own range, not the editor’s', () => {
    expect(clampFraction(0.02, HORIZONTAL)).toBe(HORIZONTAL.min)
    expect(clampFraction(0.9, HORIZONTAL)).toBe(HORIZONTAL.max)
    expect(HORIZONTAL.min).toBeGreaterThan(VERTICAL.min)
    expect(HORIZONTAL.max).toBeLessThan(VERTICAL.max)
  })

  /**
   * The key points the way the *line* moves, not the way the pane grows.
   * Dragging the divider left widens the tutor, so Left does too.
   */
  it('maps the arrow keys to the divider’s direction', () => {
    expect(fractionForKey('ArrowLeft', 0.3, 'horizontal')).toBeCloseTo(0.3 + KEY_STEP)
    expect(fractionForKey('ArrowRight', 0.3, 'horizontal')).toBeCloseTo(0.3 - KEY_STEP)
    // And ignores the other axis's keys rather than moving on them.
    expect(fractionForKey('ArrowUp', 0.3, 'horizontal')).toBeNull()
    expect(fractionForKey('ArrowLeft', 0.3, 'vertical')).toBeNull()
  })

  it('jumps to its own limits', () => {
    expect(fractionForKey('Home', 0.3, 'horizontal')).toBe(HORIZONTAL.min)
    expect(fractionForKey('End', 0.3, 'horizontal')).toBe(HORIZONTAL.max)
  })

  it('picks the limits off the axis', () => {
    expect(limitsFor('vertical')).toBe(VERTICAL)
    expect(limitsFor('horizontal')).toBe(HORIZONTAL)
  })

  // A stored tutor width must not be read against the editor's limits, or a
  // legitimate 0.1 would survive as a tutor column too narrow to read.
  it('validates a stored value against its own limits', () => {
    const map = new Map([['workbench:split:aside', '0.1']])
    const store = { getItem: (k: string) => map.get(k) ?? null } as unknown as Storage
    expect(readStoredFraction('aside', store, HORIZONTAL)).toBe(HORIZONTAL.fallback)
    expect(readStoredFraction('aside', store, VERTICAL)).toBe(0.1)
  })
})

describe('the defaults', () => {
  /**
   * The requirement, pinned: "the test output should only take about 10-20% of
   * vertical height".
   */
  it('gives the practice screen’s output pane about a fifth', () => {
    expect(DEFAULT_FRACTION).toBeGreaterThanOrEqual(0.1)
    expect(DEFAULT_FRACTION).toBeLessThanOrEqual(0.2)
  })

  it('is itself a legal fraction', () => {
    expect(clampFraction(DEFAULT_FRACTION)).toBe(DEFAULT_FRACTION)
  })
})
