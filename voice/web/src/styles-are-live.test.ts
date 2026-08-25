import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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

const SRC = join(import.meta.dirname, '.');

function read(name: string): string {
  return readFileSync(join(SRC, name), 'utf8');
}

/**
 * Comments stripped. Both the stylesheet and the component explain at length
 * *why* the deleted selectors are gone, naming them as they go, and a name in
 * prose must not read as a use. Handles `/* *\/` in CSS and TSX alike, plus
 * `//` line comments, which is all either file has.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the primary action', () => {
  const component = code(read('components/PrimaryAction.tsx'));
  const styles = code(read('styles.css'));

  it('is the design system’s Button, not a hand-styled element', () => {
    expect(component).toContain("from 'brutalkit/button'");
    expect(component).toMatch(/<Button\b/);
  });

  // The two appearances that carry a colour. `brand` and `destructive` are the
  // same tokens the hand-rolled rules named, reached through the system that
  // owns them instead of through CSS that happened to agree.
  it.each(['brand', 'destructive'])(
    'reaches its %s appearance through a Button variant',
    (variant) => {
      // Either quote style: `variant="outline"` is written as an attribute,
      // `? 'destructive' : 'brand'` inside an expression.
      expect(component).toMatch(new RegExp(`['"]${variant}['"]`));
    }
  );

  // The specific regression: class names this app invented, styled in this
  // app's stylesheet, emitted by this component, connected by nothing.
  it('defines no bespoke .primary-- variants', () => {
    expect(component).not.toMatch(/primary--/);
    expect(styles).not.toMatch(/\.primary--/);
  });

  // The one exception, and the reason it is an exception: a disabled button
  // reads as broken, and none of these waits can report a percentage.
  it('keeps the busy indicator, since Button has no variant for one', () => {
    expect(component).toContain('primary-wait');
    expect(styles).toMatch(/\.primary-wait::after \{[^}]*animation:/);
  });
});

describe('the session stream', () => {
  const stream = code(read('components/SessionStream.tsx'));

  // A transcript is a conversation, and the design system has a component for
  // one. Hand-rolling it is how the primary action ended up invisible.
  it('renders spoken turns with the design system’s Message', () => {
    expect(stream).toContain("from 'brutalkit/message'");
    expect(stream).toMatch(/<Message\b/);
    expect(stream).toMatch(/<MessageContent\b/);
  });

  // Left and right is the whole reason this reads as a conversation rather
  // than a log, and it is `Message`'s own prop rather than a class here.
  it('gives the two speakers opposite sides', () => {
    expect(stream).toMatch(/align=\{.*'start'.*'end'.*\}/);
  });

  // Colour on this screen is spoken for: red means the answer is wrong, ochre
  // means right and too expensive. A tinted bubble would put a third colour in
  // the same column and spend it on which of two people was talking.
  it('keeps the bubbles neutral, because colour here means a verdict', () => {
    const variants = [...stream.matchAll(/<Bubble variant=\{[^}]*\}/g)].map(
      (m) => m[0]!
    );
    expect(variants.length).toBeGreaterThan(0);
    for (const v of variants) {
      expect(v).not.toMatch(/'(destructive|default|tinted)'/);
    }
  });

  // Verdicts and hints were said by nobody. Giving them a speaker and a side
  // would be the screen claiming something happened that did not.
  it('does not render verdicts or hints as messages', () => {
    const verdictBranch =
      /entry\.kind === 'verdict'[\s\S]{0,400}/.exec(stream)?.[0] ?? '';
    expect(verdictBranch).not.toMatch(/<Message\b/);
  });
});

describe('the solution editor', () => {
  const editor = code(read('components/SolutionEditor.tsx'));
  const styles = code(read('styles.css'));

  // CodeMirror's base theme sets `caret-color: black` on `.cm-content`. On this
  // editor's near-black background that reads as no cursor at all, so the
  // stylesheet has to override it — and the rule that used to be here targeted
  // `.cm-cursor`, an element that only exists when `drawSelection()` is loaded.
  it('overrides the caret colour, because the base theme’s black is invisible here', () => {
    // `.code-editor`, not `.workbench__cm`: the caret colour is appearance, and
    // appearance moved onto the class the component emits so a second screen
    // cannot render this editor without it.
    expect(styles).toMatch(/\.code-editor \.cm-content \{[^}]*caret-color:/);
  });

  // `javascript()` supplies only the parser. Without a highlighter consuming
  // the tree, the editor renders undifferentiated grey text while `styles.css`
  // carries a full set of `.tok-*` colours that nothing emits.
  it('wires a highlighter, not just a language', () => {
    expect(editor).toContain('syntaxHighlighting');
    expect(editor).toContain('classHighlighter');
    expect(styles).toMatch(/\.tok-keyword/);
  });

  // `.tok-type` and `.tok-punct` looked plausible and matched nothing:
  // `classHighlighter`'s names are `tok-typeName` and `tok-punctuation`, so
  // types and punctuation rendered at the default foreground while keywords
  // and strings coloured correctly — the palette looked half-designed rather
  // than half-broken. Checked against the package's own list so a rename
  // upstream surfaces here rather than as another quietly dead rule.
  it('styles only token classes @lezer/highlight actually emits', async () => {
    const { classHighlighter } =
      (await import('@lezer/highlight')) as unknown as {
        classHighlighter: { style(tags: readonly unknown[]): string | null };
      };
    const { tags } = await import('@lezer/highlight');
    const emitted = new Set(
      Object.values(tags)
        .filter((t) => typeof t !== 'function')
        .map((t) => classHighlighter.style([t]))
        .filter((c): c is string => typeof c === 'string')
        .flatMap((c) => c.split(' '))
    );
    const styled = [...styles.matchAll(/\.(tok-[A-Za-z]+)/g)].map((m) => m[1]!);
    expect(styled.length).toBeGreaterThan(0);
    expect([...new Set(styled)].filter((c) => !emitted.has(c))).toEqual([]);
  });

  /**
   * The palette must hang off a class the editor emits itself.
   *
   * It used to be scoped to `.workbench__cm`, which the *drill screen* wrapped the
   * editor in. Practice rendered the same component without that wrapper and
   * got a bare CodeMirror — no syntax colours, no caret colour, a different
   * font. Nothing failed and no test noticed; it just looked like a different
   * editor. Scoping appearance to what the component renders is what makes a
   * third screen impossible to get wrong.
   */
  it('scopes the palette to a class SolutionEditor renders, not to one screen', () => {
    expect(editor).toContain('className="code-editor"');
    const scopes = [...styles.matchAll(/(\.[A-Za-z-]+) \.tok-/g)].map(
      (m) => m[1]!
    );
    expect(scopes.length).toBeGreaterThan(0);
    expect([...new Set(scopes)]).toEqual(['.code-editor']);
  });

  // If `drawSelection()` is ever added, `.cm-cursor` and
  // `.cm-selectionBackground` become real and styling them becomes the right
  // move again. Until then, a rule for either is dead code that reads as
  // working styling — which is how the black caret survived review.
  it('does not style elements that only exist under drawSelection()', () => {
    if (editor.includes('drawSelection')) return;
    expect(styles).not.toContain('.cm-cursor');
    expect(styles).not.toContain('.cm-selectionBackground');
  });
});

/**
 * Practice's stylesheet, against the component that renders it.
 *
 * The same check as the `tok-*` one above, for the same reason: this file has
 * three times carried rules for class names nothing emitted, and a rule that
 * matches nothing renders as plausible design rather than as breakage. The
 * caret, the syntax palette and two `tok-` selectors all reached main that way.
 */
describe('the practice screen', () => {
  const component = code(read('components/Practice.tsx'));
  const styles = code(read('styles.css'));

  it('styles only classes the component actually renders', () => {
    const styled = [...styles.matchAll(/\.(practice[A-Za-z-]*)/g)].map(
      (m) => m[1]!
    );
    expect(styled.length).toBeGreaterThan(0);
    const dead = [...new Set(styled)].filter(
      (name) => !component.includes(name)
    );
    expect(dead).toEqual([]);
  });

  /**
   * The two reds must not collapse into one colour.
   *
   * `correctness-red` and `cost-red` are the repo's central distinction — a
   * wrong answer and a working answer that costs too much call for opposite
   * next moves. The verdict survives `drill-verdict.ts` byte-identical only to
   * be flattened at the last step if these share a swatch.
   */
  it('keeps a wrong answer and an expensive one visually apart', () => {
    const wrong =
      /\.practice-verdict--wrong\s*\{[^}]*color:\s*var\((--[a-z0-9-]+)\)/.exec(
        styles
      );
    const cost =
      /\.practice-verdict--cost\s*\{[^}]*color:\s*var\((--[a-z0-9-]+)\)/.exec(
        styles
      );
    expect(wrong?.[1]).toBeTruthy();
    expect(cost?.[1]).toBeTruthy();
    expect(wrong?.[1]).not.toBe(cost?.[1]);
  });

  it('is the design system’s Button here too', () => {
    expect(component).toContain("from 'brutalkit/button'");
    expect(component).not.toMatch(/<button\b/);
  });
});

/**
 * The shell class, which is a class name and therefore the same trap.
 *
 * `.app-root` is the element that paints `var(--background)`. Practice was
 * written with `className="app"`, which no stylesheet defines — so the screen
 * had no background, fell through to the browser's white, and rendered black
 * text on dark-theme surfaces. Nothing failed; it just looked wrong.
 */
describe('the practice screen’s shell', () => {
  const app = code(read('App.tsx'));
  const styles = code(read('styles.css'));

  it('uses a shell class the stylesheet actually defines', () => {
    const shells = [...app.matchAll(/className="(app[A-Za-z-]*)"/g)].map(
      (m) => m[1]!
    );
    expect(shells).toContain('app-root');
    for (const shell of new Set(shells)) {
      // A word boundary, not `includes`. `.app-root` *contains* `.app`, so a
      // substring check reports the undefined class `.app` as defined — this
      // guard passed against the very regression it was written for until the
      // regression was planted and watched.
      const defined = new RegExp(`\\.${shell}(?![\\w-])`).test(styles);
      expect(defined, `no stylesheet rule defines .${shell}`).toBe(true);
    }
  });
});

/**
 * The problem column, which is the same duplication seen from the other side.
 *
 * `ProblemPane` styles itself for a full-width slot — `--measure`, an auto
 * margin, 28px of padding, a 32vh scrolling body. Every screen that puts it in
 * a narrow column beside an editor has to undo all four, and for a while the
 * two that do each wrote their own copy. They had already drifted: the drill
 * zeroed the pane's padding and its body's bottom padding, practice did not, so
 * the identical pane sat inset on one screen and flush on the other because
 * nobody chose either. `ProblemColumn` is the one copy.
 */
describe('the problem column', () => {
  const styles = code(read('styles.css'));
  const column = code(read('components/ProblemColumn.tsx'));

  it('is emitted by the component the rules are written for', () => {
    expect(column).toContain('problem-column');
    expect(styles).toMatch(/\.problem-column(?![\w-])/);
  });

  /**
   * The regression this replaced, stated as a rule: only `.problem-column` may
   * cancel what the pane decides about its own width and scrolling. A screen
   * writing its own copy is how the two drifted, and a third screen forgetting
   * to write one at all is the other half of the same bug — that one renders as
   * a statement running underneath the editor.
   */
  it('is the only thing that cancels the pane’s own measure and scrolling', () => {
    const rules = [...styles.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const cancels = rules.filter(
      ([, selector, body]) =>
        /\.problem-pane/.test(selector!) &&
        /max-(width|height):\s*none/.test(body!)
    );
    expect(cancels.length).toBeGreaterThan(0);
    for (const [, selector] of cancels) {
      expect(selector!.trim().startsWith('.problem-column')).toBe(true);
    }
  });

  // One renderer, reached by both screens through `Workbench`. A screen that
  // reaches for `ProblemPane` or `ProblemColumn` itself is a screen building
  // its own layout, which is the thing this stopped.
  it('is rendered by Workbench and nothing else', () => {
    expect(code(read('components/Workbench.tsx'))).toMatch(/<ProblemColumn\b/);
  });

  /**
   * Three columns need three widths that add up. The problem column's fixed
   * 560px is right for a drill's two panes and wrong beside a third: 560 plus
   * a 300-400px aside leaves the editor 280px at a 1200px viewport. So the
   * outer columns go fluid only in the three-column mode, and the centre keeps
   * the remainder - the one column that cannot be read narrower.
   */
  it('narrows the problem column only when there is a third one', () => {
    expect(styles).toMatch(
      /\.workbench--three \.workbench__problem \{[^}]*width:\s*clamp\(/
    );
    // The two-pane width stays fixed, which is what the drill screen is.
    expect(styles).toMatch(/\.workbench__problem \{[^}]*width:\s*560px/);
  });

  it.each(['App.tsx', 'components/Practice.tsx'])(
    'is how %s reaches the pane',
    (file) => {
      const source = code(read(file));
      expect(source).toMatch(/<Workbench\b/);
      expect(source).not.toMatch(/<ProblemPane\b/);
      expect(source).not.toMatch(/<ProblemColumn\b/);
    }
  );
});

/**
 * The working surface's type scale, which is the whole reason practice looked
 * like a different application.
 *
 * `--drill-mono`, every `--step-*`, `--gap-*` and `--lead-*` were declared on
 * `.drill` alone. Practice was not inside `.drill`, so every workbench rule
 * that referenced one resolved to nothing — and an undefined custom property
 * does not fail, it falls back. The same markup and the same class names
 * therefore rendered in a different font at a different size on a different
 * spacing grid, and no test, build or console message said a word.
 */
describe('the working surface’s scale', () => {
  const styles = code(read('styles.css'));

  /** The selector list of the rule that declares the scale. */
  const scaleSelector = /([^{}]+)\{[^}]*--drill-mono:/.exec(styles)?.[1] ?? '';

  it('is declared once, not once per screen', () => {
    expect(scaleSelector).not.toBe('');
    expect([...styles.matchAll(/--drill-mono:/g)]).toHaveLength(1);
  });

  // Both shells. `.drill` is the drill screen's root and practice's; `.app-root`
  // is every other screen's. A screen gets the scale by being one of them.
  it.each(['.app-root', '.drill'])('reaches %s', (shell) => {
    expect(new RegExp(`\\${shell}(?![\\w-])`).test(scaleSelector)).toBe(true);
  });

  /**
   * The scale's *box* must not ride along. `.drill` is `height: 100vh` with a
   * 14.5px body; applying that to `.app-root` would resize the chooser and the
   * history table, which share the tokens and must not share the box.
   */
  it('carries no layout of its own', () => {
    const block = /[^{}]+\{([^}]*--drill-mono:[^}]*)\}/.exec(styles)?.[1] ?? '';
    // Custom-property *declarations* stripped first: `--editor-height: 352px`
    // is a token, not a height, and a substring check cannot tell them apart.
    const body = block.replace(/--[\w-]+:[^;]*;?/g, '');
    for (const prop of ['height:', 'display:', 'font-size:', 'background:']) {
      expect(body, `the scale block must not set ${prop}`).not.toContain(prop);
    }
  });
});

/**
 * Running the suite, as a state you can see.
 *
 * A browser run can take up to `SUITE_TIMEOUT_MS` — 30 seconds — and for that
 * whole time the only feedback was the word "Running…" on a dashed-border
 * disabled button, with the pane below still reading "Nothing run yet". A
 * disabled control with no busy signal reads as broken rather than working,
 * which is exactly what makes someone press it again.
 */
describe('the run-tests busy state', () => {
  const component = code(read('components/Practice.tsx'));
  const styles = code(read('styles.css'));

  // Both, and neither alone is enough: `disabled` stops the second press,
  // `aria-busy` is what a screen reader has instead of the sweeping bar.
  it('disables the button and marks it busy while a suite runs', () => {
    expect(component).toMatch(/disabled=\{running\}/);
    expect(component).toMatch(/aria-busy=\{running\}/);
  });

  // The state is guarded in the handler too. `disabled` is a property of one
  // rendered button; the guard covers a second call from anywhere.
  it('refuses a second run in the handler, not only in the markup', () => {
    expect(component).toMatch(/if \(running\) return/);
  });

  /**
   * The indeterminate bar this app already uses for every wait with no
   * percentage to report, added *to* the design system's button. Reused rather
   * than reinvented — a second busy affordance is how two screens end up
   * disagreeing about what "working" looks like.
   */
  it('shows the app’s existing indeterminate bar rather than a new one', () => {
    expect(component).toContain('primary-wait');
    expect(styles).toMatch(/\.primary-wait::after \{[^}]*animation:/);
  });

  // The pane is where you look for the result, so it must not still say
  // "Nothing run yet" while a suite is running.
  it('says so in the pane as well as on the button', () => {
    expect(component).toMatch(/running \?[\s\S]{0,200}Running the suite/);
  });
});
