/**
 * Whether a Space keypress belongs to the element under focus rather than to
 * the page's primary action.
 *
 * Space starts and stops a turn from anywhere on the drill screen, which is
 * right when the whole screen is a transcript and a button. It stopped being
 * right when the browser editor landed: CodeMirror renders its document into a
 * **contenteditable div**, so a tag-name check against `INPUT`/`TEXTAREA` — the
 * only guard there used to be — missed it entirely. Every space typed into a
 * solution toggled the microphone instead of reaching the buffer, so code
 * arrived with its spaces stripped while a recording started behind it.
 *
 * Pulled out of the `keydown` listener so it can be tested without a DOM: the
 * listener is three lines around this predicate, and this predicate is the part
 * that can be wrong.
 */
export interface SpaceTarget {
  tagName: string
  isContentEditable?: boolean
}

/**
 * Elements whose own Space handling must win.
 *
 * `BUTTON` and `A` activate on Space; the three form controls type or open with
 * it. Listed rather than inferred from `tabIndex` or a `:focus` check because
 * the set is small, closed, and reading it should not require knowing how the
 * DOM decides what is interactive.
 */
const SPACE_IS_THEIRS = ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT']

export function targetOwnsSpace(target: SpaceTarget | null): boolean {
  if (target === null) return false
  // First, and separately from the tag list: an editable region takes Space as
  // text whatever element it happens to be rendered as. This is the general
  // form of the rule the tag list only approximates, and the tag list is kept
  // because a `<button>` is not contenteditable and still owns its Space.
  if (target.isContentEditable === true) return true
  return SPACE_IS_THEIRS.includes(target.tagName)
}
