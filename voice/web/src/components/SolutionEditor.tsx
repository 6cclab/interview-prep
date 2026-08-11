import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';

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
 */
export function editorExtensions(readOnly: boolean): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    javascript({ typescript: true }),
    EditorState.readOnly.of(readOnly),
  ];
}

interface Props {
  value: string;
  onChange(next: string): void;
  readOnly?: boolean;
}

export function SolutionEditor({ value, onChange, readOnly = false }: Props) {
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
  }, [readOnly]);

  // Adopt an externally-changed document (a reload after a 409), without
  // disturbing anything when the change came from typing.
  useEffect(() => {
    const instance = view.current;
    if (instance === null) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div ref={host} data-testid="solution-editor" />;
}
