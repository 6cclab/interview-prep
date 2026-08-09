/**
 * Just enough markdown to render a problem statement, and no more.
 *
 * The prompt was being shown as raw source — `# Find the Celebrity`, `**expensive**`,
 * backticks and fence lines all visible — which is the wrong thing to put in front
 * of someone for forty-five minutes.
 *
 * Hand-rolled rather than a dependency, because the input is not arbitrary
 * markdown: it is the committed READMEs under `system-design/` and `problems/`,
 * and a survey of every one of them finds exactly six constructs — `#` and `##`
 * headings, `-` bullets, `1.` numbers, fenced code, `**bold**` and `` `code` ``.
 * No links, no tables, no blockquotes, no rules, no nesting, no images. A
 * markdown library would bring a parser for the whole spec to render six things.
 *
 * Two consequences of that survey are load-bearing:
 *
 * - **Underscores are literal.** Every `_` in these files is inside inline code
 *   — `user_id`, `pod_name`, `1_500_000` — so treating `_x_` as emphasis would
 *   silently eat parts of identifiers and constraint bounds. There is no italic
 *   support here on purpose.
 * - **Unknown syntax degrades to text**, never to an error and never to a
 *   swallowed line. If someone writes a table into a README tomorrow, it shows up
 *   as pipes on screen — visibly unrendered, which is recoverable, rather than
 *   missing, which is not.
 *
 * Output is a block model, not an HTML string: the renderer builds React elements
 * from it, so nothing anywhere needs `dangerouslySetInnerHTML`.
 */

/**
 * A run of inline content.
 *
 * `strong` carries spans rather than a string because these files really do nest:
 * two of them write ``**`b`**`` — bold wrapping code — and a `strong` holding raw
 * text left the backticks visible on screen, which is the exact complaint this
 * renderer exists to fix. Nesting only goes this one way: a code span is verbatim,
 * so nothing is parsed inside it.
 */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; spans: Inline[] }

export type Block =
  | { kind: 'heading'; level: 1 | 2; spans: Inline[] }
  | { kind: 'paragraph'; spans: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  /** A fenced block, kept verbatim: no inline parsing happens inside code. */
  | { kind: 'code'; text: string; lang: string }

const HEADING = /^(#{1,2})\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const NUMBER = /^\d+\.\s+(.*)$/
const FENCE = /^```(.*)$/
/** A wrapped continuation of the line above — these files wrap at ~90 columns. */
const CONTINUATION = /^\s+\S/

/**
 * Inline spans, scanning left to right.
 *
 * A code span wins over emphasis whenever it opens first, so `` `a ** b` ``
 * stays code rather than being split by the asterisks inside it. An unclosed
 * marker is literal text, not an error: half a construct in a hand-edited file
 * should look wrong, not disappear.
 *
 * Bold content is parsed again, so code inside bold renders as code. The
 * recursion terminates because a `strong`'s content is taken up to the *first*
 * closing `**` and therefore can never itself contain one.
 */
export function parseInline(source: string): Inline[] {
  const spans: Inline[] = []
  let text = ''
  let i = 0

  const flush = () => {
    if (text !== '') spans.push({ kind: 'text', text })
    text = ''
  }

  while (i < source.length) {
    const backtick = source.indexOf('`', i)
    const stars = source.indexOf('**', i)
    // Whichever marker comes first, if either does.
    const next =
      backtick === -1 ? stars : stars === -1 ? backtick : Math.min(backtick, stars)
    if (next === -1) break

    if (next === backtick) {
      const close = source.indexOf('`', next + 1)
      if (close === -1) break
      text += source.slice(i, next)
      flush()
      spans.push({ kind: 'code', text: source.slice(next + 1, close) })
      i = close + 1
      continue
    }

    const close = source.indexOf('**', next + 2)
    if (close === -1) break
    text += source.slice(i, next)
    flush()
    spans.push({ kind: 'strong', spans: parseInline(source.slice(next + 2, close)) })
    i = close + 2
  }

  text += source.slice(i)
  flush()
  return spans
}

/**
 * Blocks, in order.
 *
 * A blank line ends whatever is open. An indented line continues the paragraph or
 * list item above it, which is what makes the wrapped prose in these files render
 * as sentences instead of one paragraph per source line.
 */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = []
  const lines = source.split('\n')

  // The block being accumulated, if any. Only one can be open at a time.
  let paragraph: string[] | null = null
  let list: { ordered: boolean; items: string[] } | null = null

  const closeParagraph = () => {
    if (paragraph) blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join(' ')) })
    paragraph = null
  }
  const closeList = () => {
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInline) })
    }
    list = null
  }
  const closeAll = () => {
    closeParagraph()
    closeList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    const fence = FENCE.exec(line)
    if (fence) {
      closeAll()
      // Everything up to the closing fence is taken verbatim. An unclosed fence
      // runs to the end of the file rather than being dropped — the text is
      // still the prompt, and losing the tail of a problem statement mid-drill
      // would be far worse than rendering it as one long code block.
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        body.push(lines[i]!)
        i++
      }
      blocks.push({ kind: 'code', text: body.join('\n'), lang: fence[1]!.trim() })
      continue
    }

    if (line.trim() === '') {
      closeAll()
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      closeAll()
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2,
        spans: parseInline(heading[2]!.trim()),
      })
      continue
    }

    const bullet = BULLET.exec(line)
    const numbered = NUMBER.exec(line)
    if (bullet || numbered) {
      closeParagraph()
      const ordered = numbered !== null
      // A change of list kind starts a new list rather than mixing markers.
      if (list && list.ordered !== ordered) closeList()
      list ??= { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1]!)
      continue
    }

    // An indented line continues whatever is open above it.
    if (CONTINUATION.test(line)) {
      if (list && list.items.length > 0) {
        list.items[list.items.length - 1] += ` ${line.trim()}`
        continue
      }
      if (paragraph) {
        paragraph.push(line.trim())
        continue
      }
    }

    closeList()
    paragraph ??= []
    paragraph.push(line.trim())
  }

  closeAll()
  return blocks
}
