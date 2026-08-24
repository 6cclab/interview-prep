import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseDrillLog, splitRow, type HistoryRow } from '../drill-log'
import { withRuntime, type DbClient } from './pool'

/**
 * The record Andre already has, moved into Postgres. Run once, by hand.
 *
 * Small and irreplaceable: seventeen drill-log rows, twenty-three archived
 * attempts, a pairing table, and a story bank that took months of interviews to
 * write. Nothing here is regenerable, which is the fact that shapes every
 * decision below.
 *
 * **Nothing is normalised.** The `Note` column holds multi-paragraph prose with
 * escaped pipes, strikethrough corrections, and cross-references between rows;
 * the story bank is hand-authored STAR blocks with a `Watch for:` coda. All of it
 * moves as text. A migration that tidied its input would be destroying the only
 * copy of something in order to make it fit a schema.
 *
 * **Two passes, never combined.** A dry run reports what would move and prints
 * every line it could not read, verbatim. The point of a one-time import of
 * irreplaceable history is seeing what would be dropped *before* it is dropped.
 */

export interface Rejected {
  source: string
  line: string
  reason: string
}

export interface MigrationPlan {
  drills: HistoryRow[]
  attempts: { slug: string; archivedAt: Date; content: string }[]
  pairings: { date: string; problem: string; minutes: number }[]
  stories: { competency: string; body: string }[]
  rejected: Rejected[]
}

export interface MigrationCounts {
  drills: number
  attempts: number
  pairings: number
  stories: number
  rejected: number
  /** Drill rows whose slug no longer resolves. Inserted anyway — see below. */
  orphanedDrills: number
  /** Attempts whose slug no longer resolves. Skipped — see below. */
  skippedAttempts: number
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const SLUG = /^[a-z0-9-]+$/

/**
 * `local/coached.md`, using the same row splitter the drill log uses.
 *
 * A pairing row is four cells and no prose, so unlike the drill log there is
 * nothing here worth being tolerant about: a row that does not parse is a
 * reject, not a row with defaults filled in.
 */
function readPairings(root: string, rejected: Rejected[]): MigrationPlan['pairings'] {
  const path = join(root, 'local/coached.md')
  if (!existsSync(path)) return []
  const found: MigrationPlan['pairings'] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = splitRow(line)
    if (cells.length < 4) continue
    const [date, problem, , minutes] = cells as string[]
    // The header and the `|---|` separator fail this, which is how they are
    // skipped without matching on their text.
    if (!DATE.test(date!)) continue
    if (!SLUG.test(problem!)) {
      rejected.push({ source: 'local/coached.md', line, reason: 'the problem cell is not a slug' })
      continue
    }
    const mins = Number(minutes)
    if (!Number.isFinite(mins)) {
      rejected.push({ source: 'local/coached.md', line, reason: 'the minutes cell is not a number' })
      continue
    }
    // The pattern cell is read and discarded. It is a spoiler, and the row it
    // belongs to joins to `problem.pattern` in the new schema — a second copy is
    // a second thing to forget to scrub.
    found.push({ date: date!, problem: problem!, minutes: Math.round(mins) })
  }
  return found
}

/** `<slug>-YYYY-MM-DD-HHMM.ts`, which is the only shape `pnpm reset` writes. */
const ATTEMPT = /^([a-z0-9-]+?)-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.ts$/

function readAttempts(root: string, rejected: Rejected[]): MigrationPlan['attempts'] {
  const dir = join(root, 'local/attempts')
  if (!existsSync(dir)) return []
  const found: MigrationPlan['attempts'] = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.ts')) continue
    const m = ATTEMPT.exec(name)
    if (!m) {
      rejected.push({ source: 'local/attempts', line: name, reason: 'the filename is not <slug>-<date>-<hhmm>.ts' })
      continue
    }
    const [, slug, y, mo, d, hh, mm] = m as unknown as string[]
    found.push({
      slug: slug!,
      archivedAt: new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm)),
      content: readFileSync(join(dir, name), 'utf8'),
    })
  }
  return found
}

/**
 * `local/stories.md`, which has never been read back before.
 *
 * Two shapes live in this file and both are kept. `appendStoryLog` writes
 * `## <competency>` with `**Story.**` / `**What worked.**` / `**Fix next time.**`
 * beneath it; everything currently there is hand-authored instead — a titled
 * STAR block whose `**Answers:**` line names the competency.
 *
 * The body is stored **verbatim**, including whichever shape it was in. Parsing
 * the hand-authored blocks into `worked`/`fix` columns would mean guessing which
 * STAR field is which, and guessing wrong about the only copy of a story bank
 * that took months of real interviews to write. The columns exist for rows the
 * app writes; these get the text.
 */
function readStories(root: string, rejected: Rejected[]): MigrationPlan['stories'] {
  const path = join(root, 'local/stories.md')
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  const found: MigrationPlan['stories'] = []
  // Split on `## ` headings, keeping the heading with its block.
  const blocks = text.split(/^## /m).slice(1)
  for (const block of blocks) {
    const heading = block.split('\n', 1)[0]!.trim()
    const body = `## ${block}`.trimEnd()
    // The index is a table of contents this file generates about itself, not a
    // story. Migrating it would create a row that means nothing and that nothing
    // will ever regenerate.
    if (/^index\b/i.test(heading)) continue
    const answers = /^\*\*Answers:\*\*\s*(.+)$/m.exec(block)?.[1]?.trim()
    const competency = answers ?? heading
    if (!competency) {
      rejected.push({ source: 'local/stories.md', line: heading, reason: 'no competency and no heading' })
      continue
    }
    found.push({ competency, body })
  }
  return found
}

/**
 * Everything that would move, without moving any of it.
 *
 * `parseDrillLog` is reused rather than reimplemented: it is already tolerant in
 * exactly the ways this file needs, it already unescapes pipes in the note, and a
 * second parser for the same table would drift from it.
 *
 * A line the drill-log parser silently skips is reported here as a reject, which
 * it is not equipped to do itself — the screen wants "show me what you could
 * read", and a one-time migration wants "show me what you could not".
 */
export function planMigration(root: string): MigrationPlan {
  const rejected: Rejected[] = []
  const path = join(root, 'local/drill-log.md')
  const markdown = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const drills = parseDrillLog(markdown)
  const parsedDates = new Set(drills.map((d) => `${d.date}|${d.problem}`))
  for (const line of markdown.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = splitRow(line)
    if (cells.length >= 7 && DATE.test(cells[0]!) && !parsedDates.has(`${cells[0]}|${cells[1]}`)) {
      rejected.push({ source: 'local/drill-log.md', line, reason: 'looks like a data row but did not parse' })
    }
  }

  return {
    drills,
    attempts: readAttempts(root, rejected),
    pairings: readPairings(root, rejected),
    stories: readStories(root, rejected),
    rejected,
  }
}

async function problemIds(client: DbClient): Promise<Map<string, string>> {
  const { rows } = await client.query<{ slug: string; id: string }>(
    "select slug, id from problem_public where track = 'coding'",
  )
  return new Map(rows.map((r) => [r.slug, r.id]))
}

/**
 * Write the plan, as one person, in one transaction.
 *
 * A partly-imported record is worse than an unimported one: it looks done, and
 * the only way to tell would be counting rows against a file nobody expects to
 * have to check again.
 */
export async function applyMigration(
  userId: string,
  plan: MigrationPlan,
): Promise<MigrationCounts> {
  return withRuntime(userId, async (client) => {
    const ids = await problemIds(client)
    let orphanedDrills = 0
    let skippedAttempts = 0

    for (const drill of plan.drills) {
      const problemId = ids.get(drill.problem) ?? null
      // A slug that no longer resolves still gets its row. The solved, hints and
      // elapsed numbers are real history and `/status` reads them; the problem
      // having been renamed since is not a reason to forget that the drill
      // happened. `problem_id` is `on delete set null` for the same reason.
      if (problemId === null) orphanedDrills += 1
      await client.query(
        `insert into drill_log
           (user_id, problem_id, started_at, track, solved, hints, elapsed_ms, verified_by, note)
         values ($1, $2, $3, 'coding', $4, $5, $6, 'server', $7)`,
        [
          userId,
          problemId,
          // The log records a date and no time of day, because that is all it
          // ever had. Midday rather than midnight, so a timezone conversion
          // cannot walk a row into the day before.
          new Date(`${drill.date}T12:00:00`),
          drill.result,
          drill.hints,
          drill.elapsedMs,
          drill.note,
        ],
      )
    }

    for (const attempt of plan.attempts) {
      const problemId = ids.get(attempt.slug) ?? null
      // Unlike a drill row, an attempt divorced from its problem is unreadable:
      // it is a page of code with nothing saying what question it answered. So
      // this one is skipped and reported rather than kept with a null.
      if (problemId === null) {
        skippedAttempts += 1
        continue
      }
      await client.query(
        'insert into attempt_archive (user_id, problem_id, archived_at, content) values ($1, $2, $3, $4)',
        [userId, problemId, attempt.archivedAt, attempt.content],
      )
    }

    for (const pairing of plan.pairings) {
      await client.query(
        'insert into pairing_log (user_id, problem_id, occurred_on, minutes) values ($1, $2, $3, $4)',
        [userId, ids.get(pairing.problem) ?? null, pairing.date, pairing.minutes],
      )
    }

    for (const story of plan.stories) {
      await client.query('insert into story (user_id, competency, story) values ($1, $2, $3)', [
        userId,
        story.competency,
        story.body,
      ])
    }

    return {
      drills: plan.drills.length,
      attempts: plan.attempts.length - skippedAttempts,
      pairings: plan.pairings.length,
      stories: plan.stories.length,
      rejected: plan.rejected.length,
      orphanedDrills,
      skippedAttempts,
    }
  })
}

/** The rejects file, as text. Written next to the record it came from. */
export function formatRejects(rejected: Rejected[]): string {
  return [
    '# Migration rejects',
    '',
    'Lines `pnpm migrate-local` could not read, kept verbatim. Nothing here was',
    'imported. A line is listed rather than guessed at because a row inserted with',
    'nulls would corrupt the same `/status` numbers the tolerant reader exists to',
    'protect.',
    '',
    ...rejected.flatMap(({ source, line, reason }) => [`## ${source} — ${reason}`, '', '```', line, '```', '']),
  ].join('\n')
}
