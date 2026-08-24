import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { NO_POSTGRES, postgresAvailable, startCluster, type Cluster } from '../test-helpers/pg-cluster'
import {
  applySchema,
  closePool,
  configurePool,
  databaseUrl,
  withPrivileged,
  withRelink,
  withRuntime,
} from './pool'
import { collectProblems, ingest } from './ingest'
import { dbProblems, loadProblemCache, resetProblemCache } from '../problems-db'
import { VENDOR_TABLES, applyAuthSchema, authConfig, getAuth, linkAnonymousWork, resetAuth } from './auth'

/**
 * Everything in `voice/db`, against a real Postgres.
 *
 * One file, deliberately. The cluster costs a few seconds to start and this way
 * the gate pays for it once — see `voice/test-helpers/pg-cluster.ts` for why it
 * is not a vitest `globalSetup`.
 *
 * What is being tested is mostly not TypeScript. `REVOKE SELECT ON problem`
 * either stops a query or it does not, and the only thing that knows is the
 * database. Almost every assertion here would pass against a mock while the
 * deployed instance handed out the answers.
 */

const available = postgresAvailable()
if (!available) console.warn(NO_POSTGRES)

const suite = available ? describe : describe.skip

let cluster: Cluster

/**
 * A connection as the login user, outside the role split.
 *
 * Used only where the split is not the thing under test: cleaning fixtures, and
 * reading the vendor tables Better Auth owns.
 */
async function asOwner<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: cluster.url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

suite('voice/db against a real Postgres', () => {
  beforeAll(async () => {
    cluster = startCluster()
    configurePool(cluster.url)
    await applySchema()
  }, 60_000)

  afterAll(async () => {
    await closePool()
    cluster?.stop()
  })

  beforeEach(async () => {
    resetProblemCache()
    await withPrivileged(async (client) => {
      await client.query('delete from problem')
    })
    // Per-user work is deleted as the owner, because `force row level security`
    // means even a delete has to satisfy the policy — which is itself worth
    // proving, and is proved below.
    const client = new pg.Client({ connectionString: cluster.url })
    await client.connect()
    for (const table of ['solution_buffer', 'drill_log', 'transcript', 'attempt_archive', 'pairing_log', 'story']) {
      await client.query(`delete from ${table}`)
    }
    await client.end()
  })

  // -------------------------------------------------------------------------

  describe('the schema applies more than once', () => {
    /**
     * Every deploy runs it. If a second application threw — a duplicate role, a
     * policy that already exists — the schema would be a one-shot migration
     * wearing the clothes of an idempotent one, and the second deploy is where
     * anyone would find out.
     */
    it('is idempotent', async () => {
      await expect(applySchema()).resolves.toBeUndefined()
      await expect(applySchema()).resolves.toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------

  describe('the projection gate', () => {
    beforeEach(async () => {
      await withPrivileged(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into problem (track, slug, pattern, difficulty, title, content_hash, exercise_hash)
           values ('coding', 'valid-palindrome', 'two-pointers', 'warmup', 'Valid Palindrome', 'h1', 'e1')
           returning id`,
        )
        const id = rows[0]!.id
        await client.query(
          `insert into problem_document (problem_id, kind, filename, content, is_spoiler) values
             ($1, 'readme', 'README.md', '# Valid Palindrome', false),
             ($1, 'stub', 'stub.ts', 'export function f() {}', false),
             ($1, 'solution', 'solution.ts', 'THE ANSWER: two pointers', true)`,
          [id],
        )
      })
    })

    /**
     * The load-bearing assertion of this whole phase.
     *
     * A repository-layer `toPublicProblem()` is only as strong as its weakest
     * caller: one new route doing `select *` bypasses it and nothing says so.
     * The `REVOKE` makes that query fail at the database instead — which is the
     * same shape as the filesystem guards this replaces, where the unsafe thing
     * is unreachable rather than merely discouraged.
     */
    it('stops app_runtime reading the pattern at all', async () => {
      await expect(
        withRuntime(null, (client) => client.query('select pattern from problem')),
      ).rejects.toThrow(/permission denied/i)
    })

    it('stops app_runtime reading the problem documents table', async () => {
      await expect(
        withRuntime(null, (client) => client.query('select content from problem_document')),
      ).rejects.toThrow(/permission denied/i)
    })

    it('lets app_runtime read everything that is not a spoiler', async () => {
      const rows = await withRuntime(null, async (client) => {
        const { rows } = await client.query('select slug, difficulty, title from problem_public')
        return rows
      })
      expect(rows).toEqual([{ slug: 'valid-palindrome', difficulty: 'warmup', title: 'Valid Palindrome' }])
    })

    /**
     * The view has no `pattern` column, so a caller cannot ask for one even by
     * accident — the query is a syntax-level error rather than a silently empty
     * string that reads as "no pattern authored".
     */
    it('has no pattern column to select from the public view', async () => {
      await expect(
        withRuntime(null, (client) => client.query('select pattern from problem_public')),
      ).rejects.toThrow(/column "pattern" does not exist/i)
    })

    it('withholds solution documents and serves the rest', async () => {
      const kinds = await withRuntime(null, async (client) => {
        const { rows } = await client.query<{ kind: string }>(
          'select kind from problem_document_public order by kind',
        )
        return rows.map((r) => r.kind)
      })
      expect(kinds).toEqual(['readme', 'stub'])
    })

    /**
     * `app_privileged` is the narrow door, and it is narrow in both directions:
     * it can see the answers and it can see nobody's work. That way it can never
     * become the accidental fix for a permissions error somewhere else.
     */
    it('lets app_privileged read the pattern, and nothing a person wrote', async () => {
      const pattern = await withPrivileged(async (client) => {
        const { rows } = await client.query<{ pattern: string }>('select pattern from problem')
        return rows[0]!.pattern
      })
      expect(pattern).toBe('two-pointers')

      await expect(
        withPrivileged((client) => client.query('select content from solution_buffer')),
      ).rejects.toThrow(/permission denied/i)
    })

    /**
     * A connection leaks its role if the role outlives the transaction. Pooled
     * connections are handed to the next request, so a leak here would give
     * someone else's request the spoilers.
     */
    it('does not leave the privileged role on a pooled connection', async () => {
      await withPrivileged(async (client) => {
        await client.query('select 1 from problem')
      })
      await expect(
        withRuntime(null, (client) => client.query('select pattern from problem')),
      ).rejects.toThrow(/permission denied/i)
    })
  })

  // -------------------------------------------------------------------------

  describe('row-level security', () => {
    beforeEach(async () => {
      const id = await withPrivileged(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into problem (track, slug, pattern, difficulty, content_hash)
           values ('coding', 'p', 'two-pointers', 'easy', 'h') returning id`,
        )
        return rows[0]!.id
      })
      for (const user of ['ada', 'grace']) {
        await withRuntime(user, async (client) => {
          await client.query(
            'insert into solution_buffer (user_id, problem_id, content) values ($1, $2, $3)',
            [user, id, `${user}'s code`],
          )
          await client.query(
            `insert into drill_log (user_id, problem_id, started_at, track, solved, verified_by)
             values ($1, $2, now(), 'coding', 'solved', 'browser')`,
            [user, id],
          )
        })
      }
    })

    it('shows each person only their own buffer', async () => {
      for (const user of ['ada', 'grace']) {
        const rows = await withRuntime(user, async (client) => {
          const { rows } = await client.query<{ user_id: string; content: string }>(
            'select user_id, content from solution_buffer',
          )
          return rows
        })
        expect(rows).toEqual([{ user_id: user, content: `${user}'s code` }])
      }
    })

    /**
     * The test the plan asks for by name: a query with the `WHERE user_id`
     * removed must return zero rows rather than the other person's. This is what
     * distinguishes "RLS is switched on" from "every call site happens to
     * include the clause today".
     */
    it('returns nothing, not somebody else, when the where clause is missing', async () => {
      const rows = await withRuntime('mallory', async (client) => {
        const { rows } = await client.query('select * from drill_log')
        return rows
      })
      expect(rows).toEqual([])
    })

    /** A connection with no identity is not a connection with every identity. */
    it('shows an unauthenticated connection nothing', async () => {
      const rows = await withRuntime(null, async (client) => {
        const { rows } = await client.query('select * from solution_buffer')
        return rows
      })
      expect(rows).toEqual([])
    })

    /**
     * `with check`, not just `using`. Without it the policy would filter reads
     * while happily accepting a row written under someone else's id — which
     * would then be invisible to its supposed owner and to its author alike.
     */
    it('refuses a row written under another person’s id', async () => {
      await expect(
        withRuntime('ada', (client) =>
          client.query(
            `insert into drill_log (user_id, started_at, track) values ('grace', now(), 'coding')`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('cannot update or delete a row it cannot see', async () => {
      const changed = await withRuntime('mallory', async (client) => {
        const updated = await client.query("update solution_buffer set content = 'gotcha'")
        const deleted = await client.query('delete from drill_log')
        return { updated: updated.rowCount, deleted: deleted.rowCount }
      })
      expect(changed).toEqual({ updated: 0, deleted: 0 })
    })

    /** The RLS user has the same leak risk as the role, and the same fix. */
    it('does not leave app.user_id on a pooled connection', async () => {
      await withRuntime('ada', (client) => client.query('select 1'))
      const rows = await withRuntime(null, async (client) => {
        const { rows } = await client.query('select * from solution_buffer')
        return rows
      })
      expect(rows).toEqual([])
    })

    it('covers every user-owned table', async () => {
      const rows = await withPrivileged(async (client) => {
        const { rows } = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
          `select relname, relrowsecurity, relforcerowsecurity from pg_class
           where relname in ('solution_buffer','drill_log','transcript','attempt_archive','pairing_log','story')
           order by relname`,
        )
        return rows
      })
      expect(rows).toHaveLength(6)
      for (const row of rows) {
        expect({ table: row.relname, on: row.relrowsecurity, forced: row.relforcerowsecurity }).toEqual({
          table: row.relname,
          on: true,
          forced: true,
        })
      }
    })
  })

  // -------------------------------------------------------------------------

  describe('ingestion', () => {
    const roots: string[] = []

    function repo(problems: { pattern: string; slug: string; meta?: string; solution?: string }[]): string {
      const root = mkdtempSync(join(tmpdir(), 'voice-ingest-'))
      roots.push(root)
      for (const p of problems) {
        const dir = join(root, 'problems', p.pattern, p.slug)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'README.md'), `# ${p.slug}\n`)
        writeFileSync(join(dir, 'stub.ts'), 'export function f() {}\n')
        writeFileSync(join(dir, 'solution.test.ts'), "import { f } from './solution'\n")
        writeFileSync(join(dir, 'solution.ts'), p.solution ?? 'export function f() { return 1 }\n')
        writeFileSync(join(dir, 'meta.yaml'), p.meta ?? `pattern: ${p.pattern}\ndifficulty: easy\n`)
      }
      return root
    }

    afterAll(() => {
      for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    })

    it('reads title, difficulty, budget, complexity, companies and hints out of meta.yaml', () => {
      const root = repo([
        {
          pattern: 'two-pointers',
          slug: 'valid-palindrome',
          meta: [
            'pattern: two-pointers',
            'title: Valid Palindrome',
            'difficulty: warmup',
            'budget: none — warm-up tier, correctness only',
            'complexity:',
            '  time: "O(n): one pass"',
            '  space: O(1)',
            'hints:',
            '  nudge: What is at each end?',
            '  approach: Walk inwards from both ends.',
            'companies:',
            '  - name: amazon',
            '    confidence: low',
            '',
          ].join('\n'),
        },
      ])
      const { problems, skipped } = collectProblems(root)
      expect(skipped).toEqual([])
      expect(problems).toHaveLength(1)
      const problem = problems[0]!
      expect(problem.title).toBe('Valid Palindrome')
      expect(problem.difficulty).toBe('warmup')
      expect(problem.budgetNote).toBe('none — warm-up tier, correctness only')
      expect(problem.complexity).toEqual({ time: 'O(n): one pass', space: 'O(1)' })
      expect(problem.companies).toEqual([{ name: 'amazon', confidence: 'low' }])
      expect(problem.hints).toEqual([
        { rung: 1, text: 'What is at each end?' },
        { rung: 3, text: 'Walk inwards from both ends.' },
      ])
    })

    /**
     * Rungs 2 and 4 are the pattern and the worked solution, and both already
     * exist elsewhere in the row. A second copy in `problem_hint` would be a
     * second place to forget to scrub.
     */
    it('stores only the authored rungs, never the derived ones', () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'p' }])
      expect(collectProblems(root).problems[0]!.hints).toEqual([])
    })

    /**
     * A content hash, not an mtime. A `git clone` resets every mtime in the
     * tree, so an mtime check would re-ingest everything on every deploy — and,
     * worse, would miss a real change carried in by a checkout that preserved
     * them.
     */
    it('gives the same problem the same hash across two scans, and a different one after an edit', () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'p' }])
      const first = collectProblems(root).problems[0]!
      expect(collectProblems(root).problems[0]!.contentHash).toBe(first.contentHash)
      writeFileSync(join(root, 'problems', 'two-pointers', 'p', 'README.md'), '# changed\n')
      expect(collectProblems(root).problems[0]!.contentHash).not.toBe(first.contentHash)
    })

    /**
     * The staleness signal has to be narrower than the ingest signal. A README
     * typo firing "the exercise changed under you" would teach everyone to
     * ignore the banner, which costs more than the banner is worth.
     */
    it('does not change the exercise hash when only the README moves', () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'p' }])
      const before = collectProblems(root).problems[0]!
      writeFileSync(join(root, 'problems', 'two-pointers', 'p', 'README.md'), '# reworded\n')
      const after = collectProblems(root).problems[0]!
      expect(after.exerciseHash).toBe(before.exerciseHash)
      // And the wider hash did move, so this is a genuine narrowing rather than
      // an exercise hash that never changes at all.
      expect(after.contentHash).not.toBe(before.contentHash)
    })

    it('does change the exercise hash when the stub changes', () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'p' }])
      const before = collectProblems(root).problems[0]!.exerciseHash
      writeFileSync(join(root, 'problems', 'two-pointers', 'p', 'stub.ts'), 'export function g() {}\n')
      expect(collectProblems(root).problems[0]!.exerciseHash).not.toBe(before)
    })

    it('marks the solution and the meta file spoilers, and nothing else', async () => {
      await ingest(repo([{ pattern: 'two-pointers', slug: 'p' }]))
      const rows = await withPrivileged(async (client) => {
        const { rows } = await client.query<{ kind: string; is_spoiler: boolean }>(
          'select kind, is_spoiler from problem_document order by kind',
        )
        return rows
      })
      expect(rows).toEqual([
        { kind: 'meta', is_spoiler: true },
        { kind: 'readme', is_spoiler: false },
        { kind: 'solution', is_spoiler: true },
        { kind: 'stub', is_spoiler: false },
        { kind: 'test', is_spoiler: false },
      ])
    })

    /**
     * The test that actually caught something.
     *
     * Listing the spoiler kinds by name is a test of a list, and a list only
     * knows what its author knew. This asks the question the drill actually
     * cares about — can the pattern be read — and the first run of it failed:
     * `meta.yaml` was being served publicly, and its first line is
     * `pattern: two-pointers`, with the authored hint rungs a few lines below.
     *
     * It is deliberately phrased over content rather than over kinds, so a
     * future document type that happens to embed the pattern fails here too.
     */
    it('lets no pattern reach app_runtime through any public row', async () => {
      await ingest(repo([{ pattern: 'two-pointers', slug: 'p' }]))
      const reachable = await withRuntime(null, async (client) => {
        const documents = await client.query<{ kind: string; content: string; filename: string }>(
          'select kind, content, filename from problem_document_public',
        )
        const problems = await client.query('select * from problem_public')
        return JSON.stringify([documents.rows, problems.rows])
      })
      expect(reachable).not.toContain('two-pointers')
    })

    /**
     * A skip-if-unchanged ingester silently declines to apply its own fixes.
     * Widening `SPOILER_KINDS` changes no file, so it changes no file hash, so
     * every already-ingested problem reports `unchanged` and stays exposed —
     * which is precisely what happened when `meta` was added to the set. The
     * version constant folded into the hash is what carries a rule change
     * across, and this pins that it is actually folded in.
     */
    it('re-ingests everything when the ingest rules change, not just when files do', async () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'a' }])
      await ingest(root)
      // Simulate the state a previous ingest version left behind: same files,
      // same everything, but a hash from an older rule set.
      await withPrivileged((client) => client.query("update problem set content_hash = 'v1-era-hash'"))
      const summary = await ingest(root)
      expect(summary.updated).toEqual(['a'])
      expect(summary.unchanged).toEqual([])
    })

    /** The authored rungs are behind the same door as the pattern, not a view. */
    it('gives app_runtime no way to read the hint ladder', async () => {
      await expect(
        withRuntime(null, (client) => client.query('select text from problem_hint')),
      ).rejects.toThrow(/permission denied/i)
      await expect(
        withRuntime(null, (client) => client.query('select text from problem_hint_public')),
      ).rejects.toThrow(/does not exist/i)
    })

    it('inserts, then reports the same tree as unchanged', async () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'a' }, { pattern: 'dp-1d', slug: 'b' }])
      expect((await ingest(root)).inserted.sort()).toEqual(['a', 'b'])
      const second = await ingest(root)
      expect(second.unchanged.sort()).toEqual(['a', 'b'])
      expect(second.inserted).toEqual([])
      expect(second.updated).toEqual([])
    })

    it('updates in place when a file changes', async () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'a' }])
      await ingest(root)
      writeFileSync(join(root, 'problems', 'two-pointers', 'a', 'README.md'), '# rewritten\n')
      expect((await ingest(root)).updated).toEqual(['a'])
      const readme = await withPrivileged(async (client) => {
        const { rows } = await client.query<{ content: string }>(
          "select content from problem_document where kind = 'readme'",
        )
        return rows[0]!.content
      })
      expect(readme).toBe('# rewritten\n')
    })

    /**
     * A file deleted from the repo has to disappear from the serving copy.
     * Documents are replaced wholesale rather than merged, because reconciling
     * per-row *is* a merge — and "the repo always wins" rules merges out.
     */
    it('drops a document that the repo no longer has', async () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'a' }])
      await ingest(root)
      rmSync(join(root, 'problems', 'two-pointers', 'a', 'stub.ts'))
      await ingest(root)
      const kinds = await withPrivileged(async (client) => {
        const { rows } = await client.query<{ kind: string }>('select kind from problem_document order by kind')
        return rows.map((r) => r.kind)
      })
      expect(kinds).not.toContain('stub')
    })

    /**
     * Retired, never deleted. A directory reorganisation must not be able to
     * vaporise someone's history through a cascade — `drill_log.problem_id` is
     * `on delete set null` for the same reason, and a retirement is reversible.
     */
    it('retires a problem that has left the tree, and keeps the row', async () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'a' }])
      await ingest(root)
      rmSync(join(root, 'problems', 'two-pointers', 'a'), { recursive: true })
      expect((await ingest(root)).retired).toEqual(['a'])
      const rows = await withPrivileged(async (client) => {
        const { rows } = await client.query<{ slug: string; retired_at: Date | null }>(
          'select slug, retired_at from problem',
        )
        return rows
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.retired_at).not.toBeNull()
    })

    it('un-retires a problem that comes back', async () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'a' }])
      await ingest(root)
      const away = repo([])
      await ingest(away)
      // Same tree, same hash, still retired — the hash check must not be allowed
      // to short-circuit the revival.
      await ingest(root)
      const retired = await withPrivileged(async (client) => {
        const { rows } = await client.query<{ retired_at: Date | null }>('select retired_at from problem')
        return rows[0]!.retired_at
      })
      expect(retired).toBeNull()
    })

    /**
     * The dry run has to take the real code path, or the report is a report of
     * a different, simpler program.
     */
    it('reports what a dry run would do and writes nothing', async () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'a' }])
      expect((await ingest(root, { dryRun: true })).inserted).toEqual(['a'])
      const count = await withPrivileged(async (client) => {
        const { rows } = await client.query<{ n: string }>('select count(*)::text as n from problem')
        return rows[0]!.n
      })
      expect(count).toBe('0')
    })

    /**
     * Ingestion is definitions only. Someone's in-progress code is not a thing
     * a deploy gets to touch — the staleness flag exists precisely so that it
     * never has to.
     */
    it('never touches a solution buffer', async () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'a' }])
      await ingest(root)
      const id = await withPrivileged(async (client) => {
        const { rows } = await client.query<{ id: string }>('select id from problem')
        return rows[0]!.id
      })
      await withRuntime('ada', (client) =>
        client.query('insert into solution_buffer (user_id, problem_id, content) values ($1, $2, $3)', [
          'ada',
          id,
          'half an answer',
        ]),
      )
      writeFileSync(join(root, 'problems', 'two-pointers', 'a', 'stub.ts'), 'export function g() {}\n')
      await ingest(root)
      const rows = await withRuntime('ada', async (client) => {
        const { rows } = await client.query<{ content: string }>('select content from solution_buffer')
        return rows
      })
      expect(rows).toEqual([{ content: 'half an answer' }])
    })

    it('ignores a directory with no README, exactly as the local picker does', () => {
      const root = repo([{ pattern: 'two-pointers', slug: 'a' }])
      mkdirSync(join(root, 'problems', 'two-pointers', 'not-a-problem'), { recursive: true })
      expect(collectProblems(root).problems.map((p) => p.slug)).toEqual(['a'])
    })
  })

  // -------------------------------------------------------------------------

  describe('the Postgres problem source', () => {
    const roots: string[] = []

    function seed(): string {
      const root = mkdtempSync(join(tmpdir(), 'voice-src-'))
      roots.push(root)
      for (const [pattern, slug, difficulty] of [
        ['two-pointers', 'valid-palindrome', 'warmup'],
        ['dp-1d', 'coin-change', 'medium'],
      ] as const) {
        const dir = join(root, 'problems', pattern, slug)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'README.md'), `# ${slug}\n`)
        writeFileSync(join(dir, 'stub.ts'), 'export function f() {} // THE STUB\n')
        writeFileSync(join(dir, 'solution.test.ts'), "it('x', () => {}) // THE SUITE\n")
        writeFileSync(join(dir, 'solution.ts'), 'export function f() { return 1 } // THE ANSWER\n')
        writeFileSync(join(dir, 'meta.yaml'), `pattern: ${pattern}\ndifficulty: ${difficulty}\n`)
      }
      return root
    }

    afterAll(() => {
      for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    })

    /**
     * Not lazy, and the failure has to say so. A source that quietly returned
     * an empty list before startup finished would show an empty picker, which
     * reads as "there are no problems" rather than "the server is not ready".
     */
    it('refuses to answer before the cache is loaded', () => {
      expect(() => dbProblems.list('')).toThrow(/has not been loaded/)
      expect(() => dbProblems.find('', 'valid-palindrome')).toThrow(/has not been loaded/)
    })

    it('serves what was ingested, sorted by slug, and answers a find', async () => {
      await ingest(seed())
      expect(await loadProblemCache()).toBe(2)
      expect(dbProblems.list('')).toEqual([
        { slug: 'coin-change', pattern: 'dp-1d', difficulty: 'medium' },
        { slug: 'valid-palindrome', pattern: 'two-pointers', difficulty: 'warmup' },
      ])
      expect(dbProblems.find('', 'coin-change')?.pattern).toBe('dp-1d')
      expect(dbProblems.find('', 'no-such-problem')).toBeNull()
    })

    /** `root` is accepted and ignored; a database has no directory to point at. */
    it('ignores the root it is handed', async () => {
      await ingest(seed())
      await loadProblemCache()
      expect(dbProblems.list('/nowhere')).toEqual(dbProblems.list('/somewhere-else'))
    })

    it('does not serve a retired problem', async () => {
      const root = seed()
      await ingest(root)
      rmSync(join(root, 'problems', 'dp-1d'), { recursive: true })
      await ingest(root)
      await loadProblemCache()
      expect(dbProblems.list('').map((p) => p.slug)).toEqual(['valid-palindrome'])
    })

    /**
     * A tier nobody recognises is `'unrated'`, not a crash and not a value the
     * client has no styling for. Same rule the filesystem source applies to a
     * malformed `meta.yaml`.
     */
    it('serves the README, the stub and the suite, and has no name for the solution', async () => {
      await ingest(seed())
      await loadProblemCache()
      const problem = { slug: 'valid-palindrome', pattern: 'two-pointers' }
      expect(dbProblems.document('', problem, 'readme')).toContain('# valid-palindrome')
      expect(dbProblems.document('', problem, 'stub')).toContain('THE STUB')
      expect(dbProblems.document('', problem, 'test')).toContain('THE SUITE')
      // There is no `DocumentKind` that names the worked answer, so this is a
      // type error rather than a runtime `null` — and the cache genuinely does
      // not hold it, which is what the cast proves.
      expect(dbProblems.document('', problem, 'solution' as never)).toBeNull()
    })

    /**
     * The deployed half of `voice/api-spoiler-gate.test.ts`.
     *
     * Risk #1 of the plan: the grants cannot catch a caller that legitimately
     * holds `pattern` and forwards it. The boot loader is exactly such a caller.
     * So this asserts over what the cache actually holds — every document it
     * would hand a browser — rather than over which kinds it meant to load.
     */
    it('caches no document containing the pattern', async () => {
      await ingest(seed())
      await loadProblemCache()
      for (const problem of dbProblems.list('')) {
        for (const kind of ['readme', 'stub', 'test'] as const) {
          const content = dbProblems.document('', problem, kind)
          expect(`${problem.slug}/${kind}: ${content ?? ''}`).not.toContain(problem.pattern)
        }
      }
    })

    it('falls back to unrated for a difficulty it does not know', async () => {
      await ingest(seed())
      await withPrivileged((client) => client.query("update problem set difficulty = 'spicy'"))
      await loadProblemCache()
      expect(dbProblems.list('').every((p) => p.difficulty === 'unrated')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------

  describe('identity, and carrying work across', () => {
    beforeEach(async () => {
      process.env.AUTH_SECRET = 'test-secret-not-a-real-one-0123456789'
      process.env.AUTH_BASE_URL = 'http://127.0.0.1:4173'
      resetAuth()
      await applyAuthSchema()
    })

    afterAll(() => {
      delete process.env.AUTH_SECRET
      delete process.env.AUTH_BASE_URL
    })

    async function seedWork(userId: string): Promise<void> {
      const id = await withPrivileged(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into problem (track, slug, pattern, difficulty, content_hash)
           values ('coding', 'p-${userId}', 'two-pointers', 'easy', 'h-${userId}') returning id`,
        )
        return rows[0]!.id
      })
      await withRuntime(userId, async (client) => {
        await client.query('insert into solution_buffer (user_id, problem_id, content) values ($1, $2, $3)', [
          userId,
          id,
          `${userId} typed this`,
        ])
        await client.query(
          `insert into drill_log (user_id, problem_id, started_at, track, solved)
           values ($1, $2, now(), 'coding', 'solved')`,
          [userId, id],
        )
        await client.query(
          `insert into story (user_id, competency, story) values ($1, 'Conflict', $2)`,
          [userId, `${userId}'s story`],
        )
      })
    }

    /**
     * The four vendor tables, created by Better Auth's own migrator rather than
     * by hand. `user.id` is read from what it generated — the app tables key off
     * that type rather than an assumed `uuid`.
     */
    it('creates the vendor tables and gives user.id a text key', async () => {
      const rows = await asOwner(async (client) => {
        const { rows } = await client.query<{ table_name: string; data_type: string | null }>(
          `select t.table_name, c.data_type
           from information_schema.tables t
           left join information_schema.columns c
             on c.table_name = t.table_name and c.column_name = 'id' and t.table_name = 'user'
           where t.table_schema = 'public' and t.table_name = any($1::text[])
           order by t.table_name`,
          [[...VENDOR_TABLES]],
        )
        return rows
      })
      expect(rows.map((r) => r.table_name)).toEqual(['account', 'session', 'user', 'verification'])
      expect(rows.find((r) => r.table_name === 'user')!.data_type).toBe('text')
    })

    it('applies the auth migration more than once without complaint', async () => {
      await expect(applyAuthSchema()).resolves.toBeUndefined()
    })

    /**
     * The whole point of the anonymous plugin: work follows the person onto
     * their real account, in one transaction.
     */
    it('carries every kind of work from the anonymous row to the new one', async () => {
      await seedWork('anon-1')
      expect(await linkAnonymousWork('anon-1', 'ada')).toBe(3)
      const mine = await withRuntime('ada', async (client) => {
        const buffers = await client.query('select content from solution_buffer')
        const logs = await client.query('select solved from drill_log')
        const stories = await client.query('select story from story')
        return { buffers: buffers.rowCount, logs: logs.rowCount, stories: stories.rowCount }
      })
      expect(mine).toEqual({ buffers: 1, logs: 1, stories: 1 })
      const stranded = await withRuntime('anon-1', async (client) => {
        const { rowCount } = await client.query('select 1 from solution_buffer')
        return rowCount
      })
      expect(stranded).toBe(0)
    })

    /**
     * Better Auth may retry the hook. A second run has to be a no-op, because
     * the alternative — some drills carried across and some stranded on a row
     * nobody can log into again — is a state worth making unreachable.
     */
    it('is idempotent, so a retried hook cannot half-migrate an account', async () => {
      await seedWork('anon-2')
      expect(await linkAnonymousWork('anon-2', 'grace')).toBe(3)
      expect(await linkAnonymousWork('anon-2', 'grace')).toBe(0)
      const count = await withRuntime('grace', async (client) => {
        const { rowCount } = await client.query('select 1 from solution_buffer')
        return rowCount
      })
      expect(count).toBe(1)
    })

    it('leaves other people alone', async () => {
      await seedWork('anon-3')
      await seedWork('bystander')
      await linkAnonymousWork('anon-3', 'ada')
      const theirs = await withRuntime('bystander', async (client) => {
        const { rows } = await client.query<{ content: string }>('select content from solution_buffer')
        return rows
      })
      expect(theirs).toEqual([{ content: 'bystander typed this' }])
    })

    /**
     * The relink runs as the anonymous user, so it sees that user's rows — it
     * has to, because SELECT policies gate the WHERE clause of an UPDATE. What
     * matters is that this is the *only* widening: `app.relink_to` buys the
     * right to write one specific id and nothing more.
     */
    it('reaches nobody but the two people named', async () => {
      await seedWork('anon-4')
      await seedWork('bystander-2')
      const seen = await withRelink('anon-4', 'ada', async (client) => {
        const visible = await client.query<{ content: string }>('select content from solution_buffer')
        const stolen = await client.query("update solution_buffer set user_id = 'ada' where user_id = 'bystander-2'")
        return { visible: visible.rows.map((r) => r.content), stolen: stolen.rowCount }
      })
      expect(seen).toEqual({ visible: ['anon-4 typed this'], stolen: 0 })
      const theirs = await withRuntime('bystander-2', async (client) => {
        const { rows } = await client.query<{ content: string }>('select content from solution_buffer')
        return rows
      })
      expect(theirs).toEqual([{ content: 'bystander-2 typed this' }])
    })

    /** And it can only ever hand rows to the id it was opened with. */
    it('cannot redirect the work to a third id', async () => {
      await seedWork('anon-6')
      await expect(
        withRelink('anon-6', 'ada', (client) =>
          client.query("update solution_buffer set user_id = 'mallory'"),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    /** A relink to yourself is not an error, it is nothing. */
    it('does nothing when the two ids are the same', async () => {
      await seedWork('anon-5')
      expect(await linkAnonymousWork('anon-5', 'anon-5')).toBe(0)
    })

    /**
     * A real anonymous sign-in, through the actual HTTP handler, because the
     * question "does a cookie isolate two people" cannot be answered by a stub.
     */
    it('mints a distinct anonymous identity per browser', async () => {
      const auth = getAuth()
      const first = await auth.api.signInAnonymous()
      const second = await auth.api.signInAnonymous()
      expect(first?.user.id).toBeTruthy()
      expect(second?.user.id).toBeTruthy()
      expect(first!.user.id).not.toBe(second!.user.id)

      await seedWork(first!.user.id)
      await seedWork(second!.user.id)
      for (const who of [first!.user.id, second!.user.id]) {
        const rows = await withRuntime(who, async (client) => {
          const { rows } = await client.query<{ content: string }>('select content from solution_buffer')
          return rows
        })
        expect(rows).toEqual([{ content: `${who} typed this` }])
      }
    })

    it('flags an anonymous user as anonymous', async () => {
      const auth = getAuth()
      const signed = await auth.api.signInAnonymous()
      // Read as the connecting user, not through a role. The vendor tables sit
      // outside the `app_runtime`/`app_privileged` split on purpose: Better Auth
      // owns them and talks to the pool directly, and neither app role holds any
      // privilege on them — an application query has no business reading a
      // session token or a password hash.
      const flag = await asOwner(async (client) => {
        const { rows } = await client.query<{ is_anonymous: boolean | null }>(
          'select "isAnonymous" as is_anonymous from "user" where id = $1',
          [signed!.user.id],
        )
        return rows[0]?.is_anonymous
      })
      expect(flag).toBe(true)
    })
  })
})

describe('authConfig', () => {
  /**
   * Neither defaulted. A secret generated at boot would invalidate every live
   * session on every restart and differ between replicas; a secret hard-coded
   * here would be the same on every deployment of this code, which is the same
   * as having none at all.
   */
  it('demands a secret and a base URL', () => {
    expect(() => authConfig({ AUTH_BASE_URL: 'http://x' })).toThrow(/AUTH_SECRET/)
    expect(() => authConfig({ AUTH_SECRET: 's' })).toThrow(/AUTH_BASE_URL/)
    expect(() => authConfig({ AUTH_SECRET: '', AUTH_BASE_URL: 'http://x' })).toThrow(/AUTH_SECRET/)
    expect(authConfig({ AUTH_SECRET: 's', AUTH_BASE_URL: 'http://x' })).toEqual({
      secret: 's',
      baseURL: 'http://x',
    })
  })
})

describe('databaseUrl', () => {
  /**
   * Never defaulted. A default of `postgres://localhost/postgres` would make a
   * misconfigured deployment connect to whatever happened to be listening and
   * report success.
   */
  it('demands DATABASE_URL rather than guessing one', () => {
    expect(() => databaseUrl({})).toThrow(/DATABASE_URL/)
    expect(() => databaseUrl({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/)
    expect(databaseUrl({ DATABASE_URL: 'postgres://x/y' })).toBe('postgres://x/y')
  })
})
