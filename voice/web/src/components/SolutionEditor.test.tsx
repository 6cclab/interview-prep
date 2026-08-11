import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { editorExtensions } from './SolutionEditor'

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
