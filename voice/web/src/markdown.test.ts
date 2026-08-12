import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, type Block, type Inline } from './markdown'

const REPO = join(import.meta.dirname, '../../..')

/** Every character a reader would see, markers already consumed. */
function flatten(spans: Inline[]): string {
  return spans.map((span) => (span.kind === 'strong' ? flatten(span.spans) : span.text)).join('')
}

describe('parseInline', () => {
  it('is a single text span for plain prose', () => {
    expect(parseInline('There are n people at a party')).toEqual([
      { kind: 'text', text: 'There are n people at a party' },
    ])
  })

  it('picks out inline code and bold, keeping the text between them', () => {
    expect(parseInline('a `knows(a, b)` is **expensive** here')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'code', text: 'knows(a, b)' },
      { kind: 'text', text: ' is ' },
      { kind: 'strong', spans: [{ kind: 'text', text: 'expensive' }] },
      { kind: 'text', text: ' here' },
    ])
  })

  // Every underscore in every README served is inside inline code — `user_id`,
  // `pod_name`, `1_500_000`. Treating `_x_` as emphasis would silently eat parts
  // of identifiers and of constraint bounds, so there is no italic support.
  it.each(['`user_id` or `pod_name`', '`1 <= times.length <= 1_500_000`', 'an _emphasis_ attempt'])(
    'leaves underscores alone in %j',
    (source) => {
      expect(flatten(parseInline(source))).toContain('_')
    },
  )

  // Otherwise a code span containing asterisks would be split by them.
  it('lets a code span win over emphasis markers inside it', () => {
    expect(parseInline('`a ** b`')).toEqual([{ kind: 'code', text: 'a ** b' }])
  })

  // Two of these READMEs write ``**`b`**``. With `strong` holding raw text the
  // backticks stayed on screen — the exact complaint this renderer exists to fix.
  it('parses code nested inside bold', () => {
    expect(parseInline('take course **`b`** first')).toEqual([
      { kind: 'text', text: 'take course ' },
      { kind: 'strong', spans: [{ kind: 'code', text: 'b' }] },
      { kind: 'text', text: ' first' },
    ])
  })

  it('leaves no backticks anywhere in bolded code', () => {
    expect(flatten(parseInline('course **`a`** before **`b`**'))).toBe('course a before b')
  })

  it('treats an unclosed marker as literal text rather than dropping the rest', () => {
    expect(parseInline('a `b c')).toEqual([{ kind: 'text', text: 'a `b c' }])
    expect(parseInline('a **b c')).toEqual([{ kind: 'text', text: 'a **b c' }])
  })

  it('handles a span at the very start and the very end', () => {
    expect(parseInline('`n` people')).toEqual([
      { kind: 'code', text: 'n' },
      { kind: 'text', text: ' people' },
    ])
    expect(parseInline('label of the `celebrity`')).toEqual([
      { kind: 'text', text: 'label of the ' },
      { kind: 'code', text: 'celebrity' },
    ])
  })

  it('is empty for an empty string', () => {
    expect(parseInline('')).toEqual([])
  })
})

describe('parseMarkdown', () => {
  it('reads the two heading levels these files use', () => {
    expect(parseMarkdown('# Find the Celebrity\n\n## Constraints')).toEqual([
      { kind: 'heading', level: 1, spans: [{ kind: 'text', text: 'Find the Celebrity' }] },
      { kind: 'heading', level: 2, spans: [{ kind: 'text', text: 'Constraints' }] },
    ])
  })

  // The whole reason a renderer was needed: these files wrap at about 90 columns,
  // and one paragraph per source line turned every prompt into a ragged column.
  it('joins wrapped prose into one paragraph', () => {
    const blocks = parseMarkdown('You are given `n` and a helper\n  which returns true')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' })
  })

  it('separates paragraphs on a blank line', () => {
    expect(parseMarkdown('first\n\nsecond').filter((b) => b.kind === 'paragraph')).toHaveLength(2)
  })

  it('collects consecutive bullets into one list', () => {
    const [block] = parseMarkdown('- one\n- two\n- three')
    expect(block).toMatchObject({ kind: 'list', ordered: false })
    expect((block as Extract<Block, { kind: 'list' }>).items).toHaveLength(3)
  })

  it('reads a numbered list as ordered', () => {
    expect(parseMarkdown('1. first\n2. second')[0]).toMatchObject({ kind: 'list', ordered: true })
  })

  it('starts a new list rather than mixing markers', () => {
    const lists = parseMarkdown('- a\n1. b').filter((b) => b.kind === 'list')
    expect(lists.map((l) => (l as Extract<Block, { kind: 'list' }>).ordered)).toEqual([false, true])
  })

  // A wrapped bullet is one item, not an item plus a stray paragraph.
  it('folds an indented continuation into the bullet above it', () => {
    const [block] = parseMarkdown('- `knows(a, b)` is expensive. A solution that asks\n  about every pair is too slow')
    const items = (block as Extract<Block, { kind: 'list' }>).items
    expect(items).toHaveLength(1)
    expect(flatten(items[0]!)).toContain('about every pair is too slow')
  })

  it('keeps a fenced block verbatim, with its language', () => {
    const [block] = parseMarkdown('```ts\nconst a = `x`\n**not bold**\n```')
    // No inline parsing inside code — the backticks and asterisks are content.
    expect(block).toEqual({ kind: 'code', lang: 'ts', text: 'const a = `x`\n**not bold**' })
  })

  it('keeps blank lines and indentation inside a fence', () => {
    const [block] = parseMarkdown('```\nn = 2\n\n  indented\n```')
    expect((block as Extract<Block, { kind: 'code' }>).text).toBe('n = 2\n\n  indented')
  })

  it('reads an unlabelled fence as code with no language', () => {
    expect(parseMarkdown('```\nn = 2\n```')[0]).toEqual({ kind: 'code', lang: '', text: 'n = 2' })
  })

  // Losing the tail of a problem statement mid-drill is far worse than rendering
  // it as one long code block.
  it('runs an unclosed fence to the end rather than dropping it', () => {
    const [block] = parseMarkdown('```\nn = 2\nstill here')
    expect((block as Extract<Block, { kind: 'code' }>).text).toBe('n = 2\nstill here')
  })

  it('is empty for an empty document', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n\n\n')).toEqual([])
  })

  // Unknown syntax must degrade to visible text, never to a dropped line: pipes
  // on screen are recoverable, a missing constraint is not.
  it('renders syntax it does not know as text rather than swallowing it', () => {
    const blocks = parseMarkdown('| a | b |\n| - | - |\n\n> quoted\n\n[link](url)')
    const text = blocks.map((b) => ('spans' in b ? flatten(b.spans) : '')).join(' ')
    expect(text).toContain('| a | b |')
    expect(text).toContain('> quoted')
    expect(text).toContain('[link](url)')
  })
})

/**
 * The parser only has to cover what these files actually contain, so this is the
 * test that keeps that claim true: it parses every README the server will serve
 * and asserts nothing was lost. A README written tomorrow with syntax the survey
 * never saw is caught here rather than by a prompt quietly missing a line
 * mid-drill.
 */
/**
 * The source side of the round-trip check: the README with markdown's own
 * markers removed, so what is left is exactly what the parser should have kept.
 *
 * **Markers are only markers outside a fence.** Stripping them everywhere is
 * what this used to do, and it made the check fail correct input: a ```ts block
 * containing a JSDoc comment has a literal `**` in it, which the parser is
 * required to preserve — `parseMarkdown` keeps fenced text verbatim, and the
 * "keeps a code block literal" case above pins that. The global strip deleted it
 * from the source side only, so the two sides disagreed about a file where
 * nothing was wrong. JSDoc is idiomatic TypeScript and appears in every stub in
 * this repo, so this was waiting for the first README that showed one.
 *
 * The same reasoning covers the rest of them: `#` opens a comment in several
 * languages, `-` starts a flag, and a digit followed by a period is a decimal.
 * Inside a fence none of those are markdown.
 *
 * Fence lines themselves still lose their backticks and keep their language,
 * because that is how the parser reports them — `lang` first, then `text`.
 */
function strippedOfMarkers(body: string): string {
  return body
    .split('```')
    .map((segment, index) =>
      // Odd segments are fenced: the split alternates outside, inside, outside.
      index % 2 === 1
        ? segment
        : segment
            .replace(/\*\*/g, '')
            .replace(/`/g, '')
            .replace(/^#{1,2} /gm, '')
            .replace(/^[-*] /gm, '')
            .replace(/^\d+\. /gm, ''),
    )
    .join('')
    .replace(/\s+/g, '')
}

describe('every problem statement the server serves', () => {
  const readmes: { name: string; body: string }[] = []
  for (const problem of readdirSync(join(REPO, 'system-design'), { withFileTypes: true })) {
    if (!problem.isDirectory()) continue
    const file = join(REPO, 'system-design', problem.name, 'README.md')
    if (existsSync(file)) readmes.push({ name: `system-design/${problem.name}`, body: readFileSync(file, 'utf8') })
  }
  for (const pattern of readdirSync(join(REPO, 'problems'), { withFileTypes: true })) {
    if (!pattern.isDirectory()) continue
    for (const slug of readdirSync(join(REPO, 'problems', pattern.name), { withFileTypes: true })) {
      if (!slug.isDirectory()) continue
      const file = join(REPO, 'problems', pattern.name, slug.name, 'README.md')
      // Named by slug, never by pattern — the pattern is the answer, and a test
      // name is as much a place to leak it as a screen is.
      if (existsSync(file)) readmes.push({ name: slug.name, body: readFileSync(file, 'utf8') })
    }
  }

  it('found them all, so the cases below are not vacuous', () => {
    expect(readmes.length).toBeGreaterThanOrEqual(26)
  })

  it.each(readmes.map((r) => [r.name, r.body] as const))('%s parses without losing any of its words', (_name, body) => {
    const blocks = parseMarkdown(body)
    expect(blocks.length).toBeGreaterThan(0)

    // Every non-whitespace character of the source survives into some block. The
    // only characters allowed to vanish are markdown's own markers.
    const rendered = blocks
      .flatMap((block) => {
        // Language before body, the order the fence line itself puts them in.
        if (block.kind === 'code') return [block.lang, block.text]
        if (block.kind === 'list') return block.items.map(flatten)
        return [flatten(block.spans)]
      })
      .join(' ')
      .replace(/\s+/g, '')
    expect(rendered).toBe(strippedOfMarkers(body))
  })

  it.each(readmes.map((r) => [r.name, r.body] as const))('%s leaves no raw markers on screen', (_name, body) => {
    // The complaint that prompted this: `#`, `**` and fence lines were all
    // visible. Headings and emphasis must be structure by now, not characters.
    for (const block of parseMarkdown(body)) {
      if (block.kind === 'code') continue
      const shown = 'spans' in block ? flatten(block.spans) : block.items.map(flatten).join(' ')
      expect(shown).not.toMatch(/\*\*/)
      expect(shown).not.toMatch(/^#{1,2}\s/)
      expect(shown).not.toContain('```')
    }
  })
})
