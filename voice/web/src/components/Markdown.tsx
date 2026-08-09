import { parseMarkdown, type Inline } from '../markdown'

/**
 * Renders a parsed problem statement as React elements.
 *
 * No `dangerouslySetInnerHTML` anywhere: `parseMarkdown` returns a block model and
 * this walks it, so the text is inserted as text and there is no HTML-injection
 * surface at all. The content is a committed file and so is trusted, but a
 * renderer that does not need that trust is simply better than one that does.
 */

function spans(inline: Inline[]) {
  return inline.map((span, index) => {
    if (span.kind === 'code') {
      return (
        <code key={index} className="md__code">
          {span.text}
        </code>
      )
    }
    // Recurses, so code inside bold renders as code rather than as backticks.
    if (span.kind === 'strong') return <strong key={index}>{spans(span.spans)}</strong>
    return <span key={index}>{span.text}</span>
  })
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="md">
      {parseMarkdown(source).map((block, index) => {
        switch (block.kind) {
          case 'heading':
            // h2/h3 rather than h1/h2: the page's h1 is the header's title, and a
            // second h1 inside a pane would break the document outline.
            return block.level === 1 ? (
              <h2 key={index} className="md__h1">
                {spans(block.spans)}
              </h2>
            ) : (
              <h3 key={index} className="md__h2">
                {spans(block.spans)}
              </h3>
            )
          case 'paragraph':
            return (
              <p key={index} className="md__p">
                {spans(block.spans)}
              </p>
            )
          case 'list': {
            const items = block.items.map((item, i) => <li key={i}>{spans(item)}</li>)
            return block.ordered ? (
              <ol key={index} className="md__list">
                {items}
              </ol>
            ) : (
              <ul key={index} className="md__list">
                {items}
              </ul>
            )
          }
          case 'code':
            return (
              // Wrapped in its own scroller: an example with long lines must not
              // widen the pane or push the page sideways.
              <pre key={index} className="md__pre">
                <code>{block.text}</code>
              </pre>
            )
        }
      })}
    </div>
  )
}
