import { describe, expect, it } from 'vitest'
import { targetOwnsSpace } from './keys'

describe('targetOwnsSpace', () => {
  // The regression. CodeMirror 6 puts the document in a contenteditable div —
  // not a textarea — so the tag-name check alone reported that Space belonged
  // to the page. Typing a solution then toggled the microphone once per space:
  // the buffer received `//autosavereacheddisk`, and a recording ran and failed
  // to transcribe behind it. Verified in the running app before and after.
  it('gives Space to a contenteditable div, which is what the editor is', () => {
    expect(targetOwnsSpace({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('still gives Space to a plain div back to the page', () => {
    expect(targetOwnsSpace({ tagName: 'DIV', isContentEditable: false })).toBe(false)
    expect(targetOwnsSpace({ tagName: 'DIV' })).toBe(false)
  })

  // The behaviour that already worked and must keep working: Space is the
  // documented shortcut for starting and ending a turn, and it has to reach the
  // page from the transcript, the problem pane, and the body itself.
  it.each(['DIV', 'SECTION', 'MAIN', 'P', 'BODY', 'PRE', 'SPAN'])(
    'leaves Space to the page from %s',
    (tagName) => {
      expect(targetOwnsSpace({ tagName })).toBe(false)
    }
  )

  it.each(['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'])(
    'lets %s keep its own Space',
    (tagName) => {
      expect(targetOwnsSpace({ tagName })).toBe(true)
    }
  )

  // A keydown with no target at all is the page's, not nobody's — returning
  // true here would silently disable the shortcut rather than fail visibly.
  it('treats an absent target as the page', () => {
    expect(targetOwnsSpace(null)).toBe(false)
  })

  // Both guards are live, and neither is redundant: a button is not
  // contenteditable and still owns Space, and an editable div is not in the tag
  // list and still owns Space. Dropping either one reintroduces a real bug.
  it('keeps both guards independently load-bearing', () => {
    expect(targetOwnsSpace({ tagName: 'BUTTON', isContentEditable: false })).toBe(true)
    expect(targetOwnsSpace({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })
})
