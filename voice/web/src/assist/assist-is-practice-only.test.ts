import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The drill editor has no language service, and this is what says so.
 *
 * `SolutionEditor.tsx` used to carry the whole rule by itself: it imported no
 * autocomplete, no lint, no TypeScript, and `SolutionEditor.test.tsx` failed if
 * anyone added one. That test still exists and still passes — the component is
 * still a plain document.
 *
 * What changed is that the capability now exists in the tree, one screen away.
 * `Practice.tsx` composes it in by passing `assistExtensions()` to the same
 * component, because Practice is untimed, unrecorded and has a tutor beside it,
 * and working out what a problem *is* is not the same activity as rehearsing an
 * interview. A drill is the rehearsal. Giving it tooling that CoderPad,
 * HackerRank and CodeSignal do not have rehearses an advantage that will not be
 * there on the day, which is the reason the rule was written.
 *
 * So the boundary moved from "no such capability exists" to "the drill's call
 * site is handed none of it", and a boundary that is not tested is a comment.
 * This is the test. If it fails, the added wiring is the defect — not this
 * file.
 */

const SRC = join(import.meta.dirname, '..')
const APP = readFileSync(join(SRC, 'App.tsx'), 'utf8')
const PRACTICE = readFileSync(join(SRC, 'components/Practice.tsx'), 'utf8')

/** Anything that would put a language service behind an editor. */
const ASSIST = /assist\/|assistExtensions|useAssist|@codemirror\/(autocomplete|lint)/

describe('the drill screen', () => {
  it('imports nothing from the assist', () => {
    const offending = APP.split('\n').filter(
      (line) => /^\s*import\b/.test(line) && ASSIST.test(line),
    )
    expect(offending).toEqual([])
  })

  it('renders its editor without extensions', () => {
    // `App.tsx` has exactly one `<SolutionEditor`, and it is the drill's. An
    // `extensions=` on it is the regression this whole file exists to catch —
    // and it would be an easy one to make, because the prop is right there and
    // the Practice call site three files away shows how.
    const opens = APP.match(/<SolutionEditor\b[\s\S]*?\/>/g) ?? []
    expect(opens).toHaveLength(1)
    expect(opens[0]).not.toMatch(/extensions/)
  })
})

describe('the practice screen', () => {
  it('does wire the assist in, so the rule above is a boundary and not a ban', () => {
    // The other half. Without this, deleting the Practice wiring would leave
    // both guards green and the feature silently gone — which is exactly how
    // the `tok-*` palette spent months rendering grey text.
    expect(PRACTICE).toMatch(/useAssist/)
    expect(PRACTICE).toMatch(/<SolutionEditor[\s\S]*?extensions=\{assist\}/)
  })
})
