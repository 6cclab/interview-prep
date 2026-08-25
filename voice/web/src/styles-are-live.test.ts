import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Styles that are actually reachable, and components that come from the design
 * system rather than from here.
 *
 * Both guards exist because of the same failure, twice. `styles.css` carried
 * rules for class names nothing emitted, and the app rendered a black
 * rectangle on a black dock and a black caret on a black editor — neither of
 * which looks like a missing style. It looks like a design choice.
 *
 * For the button the fix is structural rather than a test: a hand-rolled
 * `.primary--go` is a variant this app can delete by accident (`851d267` did),
 * where `variant="brand"` is one it cannot. This file's job is to keep it that
 * way, because the pull back toward hand-styling is real — the deleted code
 * had a considered comment explaining why the design system did not fit.
 */

const SRC = join(import.meta.dirname, '.')

function read(name: string): string {
  return readFileSync(join(SRC, name), 'utf8')
}

/**
 * Comments stripped. Both the stylesheet and the component explain at length
 * *why* the deleted selectors are gone, naming them as they go, and a name in
 * prose must not read as a use. Handles `/* *\/` in CSS and TSX alike, plus
 * `//` line comments, which is all either file has.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the primary action', () => {
  const component = code(read('components/PrimaryAction.tsx'))
  const styles = code(read('styles.css'))

  it('is the design system’s Button, not a hand-styled element', () => {
    expect(component).toContain("from 'brutalkit/button'")
    expect(component).toMatch(/<Button\b/)
  })

  // The two appearances that carry a colour. `brand` and `destructive` are the
  // same tokens the hand-rolled rules named, reached through the system that
  // owns them instead of through CSS that happened to agree.
  it.each(['brand', 'destructive'])('reaches its %s appearance through a Button variant', (variant) => {
    // Either quote style: `variant="outline"` is written as an attribute,
    // `? 'destructive' : 'brand'` inside an expression.
    expect(component).toMatch(new RegExp(`['"]${variant}['"]`))
  })

  // The specific regression: class names this app invented, styled in this
  // app's stylesheet, emitted by this component, connected by nothing.
  it('defines no bespoke .primary-- variants', () => {
    expect(component).not.toMatch(/primary--/)
    expect(styles).not.toMatch(/\.primary--/)
  })

  // The one exception, and the reason it is an exception: a disabled button
  // reads as broken, and none of these waits can report a percentage.
  it('keeps the busy indicator, since Button has no variant for one', () => {
    expect(component).toContain('primary-wait')
    expect(styles).toMatch(/\.primary-wait::after \{[^}]*animation:/)
  })
})

describe('the session stream', () => {
  const stream = code(read('components/SessionStream.tsx'))

  // A transcript is a conversation, and the design system has a component for
  // one. Hand-rolling it is how the primary action ended up invisible.
  it('renders spoken turns with the design system’s Message', () => {
    expect(stream).toContain("from 'brutalkit/message'")
    expect(stream).toMatch(/<Message\b/)
    expect(stream).toMatch(/<MessageContent\b/)
  })

  // Left and right is the whole reason this reads as a conversation rather
  // than a log, and it is `Message`'s own prop rather than a class here.
  it('gives the two speakers opposite sides', () => {
    expect(stream).toMatch(/align=\{.*'start'.*'end'.*\}/)
  })

  // Colour on this screen is spoken for: red means the answer is wrong, ochre
  // means right and too expensive. A tinted bubble would put a third colour in
  // the same column and spend it on which of two people was talking.
  it('keeps the bubbles neutral, because colour here means a verdict', () => {
    const variants = [...stream.matchAll(/<Bubble variant=\{[^}]*\}/g)].map((m) => m[0]!)
    expect(variants.length).toBeGreaterThan(0)
    for (const v of variants) {
      expect(v).not.toMatch(/'(destructive|default|tinted)'/)
    }
  })

  // Verdicts and hints were said by nobody. Giving them a speaker and a side
  // would be the screen claiming something happened that did not.
  it('does not render verdicts or hints as messages', () => {
    const verdictBranch = /entry\.kind === 'verdict'[\s\S]{0,400}/.exec(stream)?.[0] ?? ''
    expect(verdictBranch).not.toMatch(/<Message\b/)
  })
})

describe('the solution editor', () => {
  const editor = code(read('components/SolutionEditor.tsx'))
  const styles = code(read('styles.css'))

  // CodeMirror's base theme sets `caret-color: black` on `.cm-content`. On this
  // editor's near-black background that reads as no cursor at all, so the
  // stylesheet has to override it — and the rule that used to be here targeted
  // `.cm-cursor`, an element that only exists when `drawSelection()` is loaded.
  it('overrides the caret colour, because the base theme’s black is invisible here', () => {
    expect(styles).toMatch(/\.drill-cm \.cm-content \{[^}]*caret-color:/)
  })

  // `javascript()` supplies only the parser. Without a highlighter consuming
  // the tree, the editor renders undifferentiated grey text while `styles.css`
  // carries a full set of `.tok-*` colours that nothing emits.
  it('wires a highlighter, not just a language', () => {
    expect(editor).toContain('syntaxHighlighting')
    expect(editor).toContain('classHighlighter')
    expect(styles).toMatch(/\.tok-keyword/)
  })

  // `.tok-type` and `.tok-punct` looked plausible and matched nothing:
  // `classHighlighter`'s names are `tok-typeName` and `tok-punctuation`, so
  // types and punctuation rendered at the default foreground while keywords
  // and strings coloured correctly — the palette looked half-designed rather
  // than half-broken. Checked against the package's own list so a rename
  // upstream surfaces here rather than as another quietly dead rule.
  it('styles only token classes @lezer/highlight actually emits', async () => {
    const { classHighlighter } = (await import('@lezer/highlight')) as unknown as {
      classHighlighter: { style(tags: readonly unknown[]): string | null }
    }
    const { tags } = await import('@lezer/highlight')
    const emitted = new Set(
      Object.values(tags)
        .filter((t) => typeof t !== 'function')
        .map((t) => classHighlighter.style([t]))
        .filter((c): c is string => typeof c === 'string')
        .flatMap((c) => c.split(' ')),
    )
    const styled = [...styles.matchAll(/\.(tok-[A-Za-z]+)/g)].map((m) => m[1]!)
    expect(styled.length).toBeGreaterThan(0)
    expect([...new Set(styled)].filter((c) => !emitted.has(c))).toEqual([])
  })

  // If `drawSelection()` is ever added, `.cm-cursor` and
  // `.cm-selectionBackground` become real and styling them becomes the right
  // move again. Until then, a rule for either is dead code that reads as
  // working styling — which is how the black caret survived review.
  it('does not style elements that only exist under drawSelection()', () => {
    if (editor.includes('drawSelection')) return
    expect(styles).not.toContain('.cm-cursor')
    expect(styles).not.toContain('.cm-selectionBackground')
  })
})

/**
 * Practice's stylesheet, against the component that renders it.
 *
 * The same check as the `tok-*` one above, for the same reason: this file has
 * three times carried rules for class names nothing emitted, and a rule that
 * matches nothing renders as plausible design rather than as breakage. The
 * caret, the syntax palette and two `tok-` selectors all reached main that way.
 */
describe('the practice screen', () => {
  const component = code(read('components/Practice.tsx'))
  const styles = code(read('styles.css'))

  it('styles only classes the component actually renders', () => {
    const styled = [...styles.matchAll(/\.(practice[A-Za-z-]*)/g)].map((m) => m[1]!)
    expect(styled.length).toBeGreaterThan(0)
    const dead = [...new Set(styled)].filter((name) => !component.includes(name))
    expect(dead).toEqual([])
  })

  /**
   * The two reds must not collapse into one colour.
   *
   * `correctness-red` and `cost-red` are the repo's central distinction — a
   * wrong answer and a working answer that costs too much call for opposite
   * next moves. The verdict survives `drill-verdict.ts` byte-identical only to
   * be flattened at the last step if these share a swatch.
   */
  it('keeps a wrong answer and an expensive one visually apart', () => {
    const wrong = /\.practice-verdict--wrong\s*\{[^}]*color:\s*var\((--[a-z0-9-]+)\)/.exec(styles)
    const cost = /\.practice-verdict--cost\s*\{[^}]*color:\s*var\((--[a-z0-9-]+)\)/.exec(styles)
    expect(wrong?.[1]).toBeTruthy()
    expect(cost?.[1]).toBeTruthy()
    expect(wrong?.[1]).not.toBe(cost?.[1])
  })

  it('is the design system’s Button here too', () => {
    expect(component).toContain("from 'brutalkit/button'")
    expect(component).not.toMatch(/<button\b/)
  })
})

/**
 * The shell class, which is a class name and therefore the same trap.
 *
 * `.app-root` is the element that paints `var(--background)`. Practice was
 * written with `className="app"`, which no stylesheet defines — so the screen
 * had no background, fell through to the browser's white, and rendered black
 * text on dark-theme surfaces. Nothing failed; it just looked wrong.
 */
describe('the practice screen’s shell', () => {
  const app = code(read('App.tsx'))
  const styles = code(read('styles.css'))

  it('uses a shell class the stylesheet actually defines', () => {
    const shells = [...app.matchAll(/className="(app[A-Za-z-]*)"/g)].map((m) => m[1]!)
    expect(shells).toContain('app-root')
    for (const shell of new Set(shells)) {
      // A word boundary, not `includes`. `.app-root` *contains* `.app`, so a
      // substring check reports the undefined class `.app` as defined — this
      // guard passed against the very regression it was written for until the
      // regression was planted and watched.
      const defined = new RegExp(`\\.${shell}(?![\\w-])`).test(styles)
      expect(defined, `no stylesheet rule defines .${shell}`).toBe(true)
    }
  })
})
