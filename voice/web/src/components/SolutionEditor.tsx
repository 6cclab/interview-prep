import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';

/**
 * A deliberately limited editor.
 *
 * Syntax highlighting, line numbers, bracket matching, undo. **No TypeScript
 * language service, no autocomplete, no inline diagnostics, no
 * go-to-definition** — their absence is the feature, not an unfinished job.
 * A real coding screen (CoderPad, HackerRank, CodeSignal) gives you a plain
 * document, so drilling with a full IDE rehearses an advantage you will not
 * have on the day.
 *
 * This is also why the editor is CodeMirror rather than Monaco: Monaco bundles
 * the language service, so getting this experience out of it means switching
 * off its main feature, and a later contributor would reasonably switch it
 * back on.
 *
 * Exported separately from the component so the extension list — which is the
 * actual design decision — can be asserted without a DOM.
 *
 * `@codemirror/autocomplete` and `@codemirror/lint` are present in
 * `node_modules` — they arrive transitively via `@codemirror/lang-javascript`
 * — but nothing here imports or wires them, and they must stay unwired. They
 * cannot be dropped without dropping JavaScript syntax support entirely, so
 * their presence on the dependency tree is expected and does not mean the
 * constraint above has been violated.
 *
 * ---
 *
 * **The `extensions` prop, and why it does not weaken any of the above.**
 *
 * The Practice screen composes a TypeScript language service in — completions,
 * hover types, inline diagnostics, the lot — by passing `assistExtensions()`
 * here. That is deliberate and it is *not* an exception to the rule, because
 * the rule was always about the drill. Practice is untimed, unrecorded, has a
 * tutor beside it and a header that says `nothing is recorded`; it is where you
 * work out what a problem *is*. The drill is the rehearsal, and a rehearsal
 * with tooling you will not have on the day rehearses the wrong thing.
 *
 * So the boundary moved from "this component has no such capability" to "the
 * drill's call site hands it none", and it is still a boundary a test can hold:
 * `SolutionEditor.test.tsx` still fails on a forbidden import *here*, and
 * `assist/assist-is-practice-only.test.ts` fails if the drill's editor in
 * `App.tsx` is ever given these extensions. Both must stay.
 */
export function editorExtensions(readOnly: boolean): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    javascript({ typescript: true }),
    // `javascript()` only supplies the parser. Without a highlighter wired on
    // top of it, the tree is built and then nothing is done with it — which is
    // how this editor spent its whole life rendering undifferentiated grey
    // text while `styles.css` carried a full set of `.tok-*` colours that
    // nothing ever emitted.
    //
    // `classHighlighter` rather than a `HighlightStyle`: it tags nodes with
    // stable `tok-keyword`/`tok-string`/`tok-comment` class names and leaves
    // the colours to CSS, which is what lets the palette come from the
    // Brutalkit tokens and follow the light/dark theme. A `HighlightStyle`
    // would move those colours into this file, where the theme cannot reach
    // them.
    syntaxHighlighting(classHighlighter),
    EditorState.readOnly.of(readOnly),
  ];
}

interface Props {
  value: string;
  onChange(next: string): void;
  readOnly?: boolean;
  /**
   * Appended after the base list, so a caller can add capability without this
   * component knowing what it is. Only Practice passes anything — see the doc
   * comment above, and the test that keeps it that way.
   *
   * Must be referentially stable: the editor is rebuilt when it changes, which
   * discards the cursor and the undo history. Practice holds it in a `useMemo`
   * keyed on the problem.
   */
  extensions?: Extension[];
}

export function SolutionEditor({ value, onChange, readOnly = false, extensions }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (host.current === null) return;
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...editorExtensions(readOnly),
          ...(extensions ?? []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
    // Mounted once. `value` is deliberately excluded: this is an uncontrolled
    // editor after mount, because reconstructing state on every keystroke would
    // throw away the cursor and the undo history. External replacements go
    // through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, extensions]);

  // Adopt an externally-changed document (a reload after a 409), without
  // disturbing anything when the change came from typing.
  useEffect(() => {
    const instance = view.current;
    if (instance === null) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  // `code-editor` is emitted by the component, never by the caller.
  //
  // Every editor style — the mono font, the gutters, the active line, the caret
  // colour, the whole `tok-*` syntax palette — used to be scoped to `.workbench__cm`,
  // a class the *drill screen* wrapped this in. So a second screen rendering
  // this component got a bare CodeMirror: no palette, no caret colour, a
  // different font. Nothing failed; it just looked like a different editor,
  // which is exactly how long that kind of bug survives.
  //
  // Appearance belongs to the editor, so the editor emits the hook for it.
  // Layout still belongs to the screen — see `.workbench__cm` and
  // `.practice-editor`, which set height and nothing else.
  return <div ref={host} className="code-editor" data-testid="solution-editor" />;
}
