import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { editorExtensions } from './SolutionEditor'

const SOURCE_PATH = join(import.meta.dirname, 'SolutionEditor.tsx')

/**
 * `@codemirror/autocomplete` and `@codemirror/lint` are already sitting in
 * `node_modules` as transitive dependencies of `@codemirror/lang-javascript`
 * (see the doc comment on `editorExtensions`), so wiring either one in is a
 * single import away and would read, at a glance, like an improvement — more
 * capable editor, fewer rough edges. It is not: no autocomplete, no inline
 * diagnostics, no language service is the entire product requirement (a real
 * coding screen gives no IDE, so drilling with one rehearses an advantage you
 * will not have in an interview). This test reads the component's own source
 * text and fails if it imports from any of the forbidden packages, so a
 * future contributor adding one breaks a test instead of shipping a
 * regression that looks like a feature. A reviewer seeing this test fail
 * should treat the added import as the defect, not the test.
 */
describe('editorExtensions does not import forbidden capabilities', () => {
  const source = readFileSync(SOURCE_PATH, 'utf-8')
  const importLines = source
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line))

  const forbidden = [/@codemirror\/autocomplete/, /@codemirror\/lint/, /typescript/i, /language-service/i, /copilot/i]

  it('imports no autocomplete, lint, or language-service package', () => {
    const offending = importLines.filter((line) => forbidden.some((pattern) => pattern.test(line)))
    expect(offending).toEqual([])
  })
})

/**
 * The extension list IS the design here — what is absent matters as much as
 * what is present — so it is asserted directly rather than through the DOM.
 * Asserting that CodeMirror renders would be testing CodeMirror.
 */
describe('editorExtensions', () => {
  it('builds a usable state with the configured extensions', () => {
    const state = EditorState.create({ doc: 'const x = 1\n', extensions: editorExtensions(false) })
    expect(state.doc.toString()).toBe('const x = 1\n')
  })

  it('is read-only when asked', () => {
    const state = EditorState.create({ doc: 'x', extensions: editorExtensions(true) })
    expect(state.readOnly).toBe(true)
  })

  it('is editable by default', () => {
    const state = EditorState.create({ doc: 'x', extensions: editorExtensions(false) })
    expect(state.readOnly).toBe(false)
  })
})
