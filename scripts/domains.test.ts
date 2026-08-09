import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  companyDomains,
  companyPath,
  domainCounts,
  DOMAIN_TRACKS,
  listExercises,
  matchDomains,
} from './domains'

let root: string

function seed(track: string, slug: string, meta: string | null) {
  const dir = join(root, track, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'README.md'), `# ${slug}`)
  if (meta !== null) writeFileSync(join(dir, 'meta.yaml'), meta)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'domains-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listExercises', () => {
  it('reads the title and domains out of a meta', () => {
    seed('feature', 'idempotent-payments', 'title: Make payment capture idempotent\ndomains:\n  - payments\n  - idempotency\n')
    expect(listExercises(root)).toEqual([
      {
        track: 'feature',
        slug: 'idempotent-payments',
        title: 'Make payment capture idempotent',
        domains: ['payments', 'idempotency'],
      },
    ])
  })

  // The track comes from the directory, not the file. A `track:` field would be
  // a second source of truth for what the path already states, and a
  // copy-pasted meta would then file an exercise under a track it is not in
  // with nothing to contradict it.
  it('takes the track from the directory, ignoring any track the file claims', () => {
    seed('debugging', 'loyalty-discount', 'track: system-design\ntitle: T\ndomains:\n  - pricing-promotions\n')
    expect(listExercises(root)[0]!.track).toBe('debugging')
  })

  it('falls back to the slug when a meta has no title', () => {
    seed('feature', 'menu-modifiers', 'domains:\n  - menu-modelling\n')
    expect(listExercises(root)[0]!.title).toBe('menu-modifiers')
  })

  // A missing or untagged meta is a to-do, not an error: this is read during a
  // drill, and half the point of the CLI is to show what is tagged so far.
  it.each([
    ['no meta at all', null],
    ['a meta with no domains key', 'title: T\n'],
    ['a meta with an empty domains list', 'title: T\ndomains:\n'],
  ])('skips an exercise with %s rather than failing', (_name, meta) => {
    seed('feature', 'tagged', 'domains:\n  - payments\n')
    seed('feature', 'untagged', meta)
    expect(listExercises(root).map((e) => e.slug)).toEqual(['tagged'])
  })

  it('walks every domain track and orders them as declared', () => {
    for (const track of DOMAIN_TRACKS) seed(track, `${track}-one`, 'domains:\n  - d\n')
    expect(listExercises(root).map((e) => e.track)).toEqual([...DOMAIN_TRACKS])
  })

  it('ignores tracks that carry patterns instead of domains', () => {
    // `problems/` metas have `pattern:`, and the pattern is a spoiler — it must
    // never be surfaced by a listing that gets shown during a drill.
    seed('problems', 'two-pointers', 'pattern: two-pointers\ndomains:\n  - arrays\n')
    seed('feature', 'menu-modifiers', 'domains:\n  - menu-modelling\n')
    expect(listExercises(root).map((e) => e.slug)).toEqual(['menu-modifiers'])
  })

  it('returns nothing rather than throwing on a repo with none of the tracks', () => {
    expect(listExercises(mkdtempSync(join(tmpdir(), 'domains-empty-')))).toEqual([])
  })
})

describe('the meta reader', () => {
  it('tolerates comments, blank lines and quoted values', () => {
    seed('feature', 'x', '# a note\n\ntitle: "Quoted: with a colon"\n\ndomains:\n  # why these\n  - payments\n  - "idempotency"\n')
    expect(listExercises(root)[0]).toMatchObject({
      title: 'Quoted: with a colon',
      domains: ['payments', 'idempotency'],
    })
  })

  // The list is terminated by the next unindented key. Without that, a key
  // appearing after `domains:` would have its own list items absorbed — or
  // worse, the key line itself would end up looking like part of the domains.
  it('stops collecting at the next top-level key', () => {
    seed('feature', 'x', 'domains:\n  - payments\nnotes:\n  - not a domain\n')
    expect(listExercises(root)[0]!.domains).toEqual(['payments'])
  })

  it('reads a title that follows the domains list', () => {
    seed('feature', 'x', 'domains:\n  - payments\ntitle: After the list\n')
    expect(listExercises(root)[0]!.title).toBe('After the list')
  })
})

describe('domainCounts', () => {
  it('counts each domain across exercises, commonest first then alphabetical', () => {
    const exercises = listExercises(root)
    expect(domainCounts(exercises)).toEqual([])
    seed('feature', 'a', 'domains:\n  - payments\n  - idempotency\n')
    seed('debugging', 'b', 'domains:\n  - payments\n')
    seed('system-design', 'c', 'domains:\n  - offline-sync\n')
    expect(domainCounts(listExercises(root))).toEqual([
      { domain: 'payments', count: 2 },
      { domain: 'idempotency', count: 1 },
      { domain: 'offline-sync', count: 1 },
    ])
  })
})

describe('matchDomains', () => {
  beforeEach(() => {
    seed('system-design', 'offline-order-capture', 'title: Offline Order Capture\ndomains:\n  - offline-sync\n  - conflict-resolution\n  - restaurant-pos\n')
    seed('feature', 'idempotent-payments', 'title: Idempotent payments\ndomains:\n  - payments\n  - idempotency\n')
    seed('feature', 'menu-modifiers', 'title: Modifier groups\ndomains:\n  - menu-modelling\n  - data-modelling\n')
  })

  it('returns each match with the wanted domains that caused it', () => {
    const matches = matchDomains(listExercises(root), ['payments'])
    expect(matches).toHaveLength(1)
    expect(matches[0]!.exercise.slug).toBe('idempotent-payments')
    // The reason for the selection, not just the selection: this is what tells
    // him which of a company's domains the drill is actually practising.
    expect(matches[0]!.matched).toEqual(['payments'])
  })

  // An exercise sitting at the intersection of two of a company's domains is a
  // better use of a session than one that clips a single domain.
  it('ranks an exercise covering more of the wanted domains first', () => {
    const matches = matchDomains(listExercises(root), ['offline-sync', 'restaurant-pos', 'payments'])
    expect(matches.map((m) => m.exercise.slug)).toEqual(['offline-order-capture', 'idempotent-payments'])
    expect(matches[0]!.matched).toEqual(['offline-sync', 'restaurant-pos'])
  })

  it('reports only the wanted domains, not everything the exercise carries', () => {
    const [match] = matchDomains(listExercises(root), ['offline-sync'])
    expect(match!.matched).toEqual(['offline-sync'])
  })

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(matchDomains(listExercises(root), ['  PAYMENTS '])).toHaveLength(1)
  })

  // A near-miss that silently matched would put an exercise in front of him
  // with a fabricated reason. A domain typo matching nothing is the better
  // failure: it is visible, and `pnpm domains` lists the real ones.
  it.each(['payment', 'pay', 'payments-api', 'offline', ''])('does not match %j', (domain) => {
    expect(matchDomains(listExercises(root), [domain])).toEqual([])
  })

  it('is empty, not an error, when nothing fits', () => {
    expect(matchDomains(listExercises(root), ['quantum-billing'])).toEqual([])
  })
})

describe('companyDomains', () => {
  it('reads the marker from anywhere in the doc', () => {
    const doc = '# Toast\n\nSome prose.\n\n<!-- drill-domains: payments, offline-sync -->\n\nMore prose.\n'
    expect(companyDomains(doc)).toEqual(['payments', 'offline-sync'])
  })

  // No marker and an empty marker are different answers: the first means the
  // doc has not been tagged, which the CLI explains how to fix; the second is a
  // deliberate "nothing here applies".
  it('distinguishes an untagged doc from one declaring nothing applies', () => {
    expect(companyDomains('# Toast\n\nNo marker here.\n')).toBeNull()
    expect(companyDomains('<!-- drill-domains: -->')).toEqual([])
  })

  it('tolerates spacing and trailing commas', () => {
    expect(companyDomains('<!--   drill-domains:  payments ,  offline-sync , -->')).toEqual([
      'payments',
      'offline-sync',
    ])
  })

  it('ignores a mention of the marker inside prose', () => {
    const doc = 'Add a line like `<!-- drill-domains: payments -->` to tag this. Really: no tag yet.\n'
    expect(companyDomains(doc)).toBeNull()
  })
})

describe('companyPath', () => {
  beforeEach(() => {
    mkdirSync(join(root, 'local', 'companies'), { recursive: true })
    writeFileSync(join(root, 'local', 'companies', 'toast.md'), '# Toast')
  })

  it('finds an existing research doc', () => {
    expect(companyPath(root, 'toast')).toBe(join(root, 'local', 'companies', 'toast.md'))
  })

  it('is null when there is no research for the company', () => {
    expect(companyPath(root, 'no-such-company')).toBeNull()
  })

  // The company name reaches this from argv, so it gets the same treatment as
  // any other untrusted string that ends up naming a file.
  it.each(['../../patterns.md', '/etc/passwd', 'toast/../../..', 'Toast', 'toast ', ''])(
    'refuses %j',
    (slug) => {
      expect(companyPath(root, slug)).toBeNull()
    },
  )
})

// The tags are only useful if they are actually there. This runs against the
// real repo, so an exercise added without domains is caught here rather than by
// quietly never appearing in a company's drill list.
describe('the real exercise set', () => {
  it('tags every exercise in every domain track', () => {
    const tagged = new Set(listExercises(process.cwd()).map((e) => `${e.track}/${e.slug}`))
    let total = 0
    for (const track of DOMAIN_TRACKS) {
      const base = join(process.cwd(), track)
      if (!existsSync(base)) continue
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        if (!existsSync(join(base, entry.name, 'README.md'))) continue
        total++
        expect(tagged.has(`${track}/${entry.name}`), `${track}/${entry.name} declares no domains`).toBe(true)
      }
    }
    // Guards against the loop finding nothing and passing vacuously.
    expect(total).toBeGreaterThanOrEqual(11)
  })
})
