import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Audits every authored exercise against its track's contract.
 *
 * **It reports on files without ever printing their contents, and that is a
 * requirement rather than a style choice.** Running this must not spoil anything:
 * it opens `patterns.md` and `solutions/**` to answer yes/no questions about them
 * — does a row exist, does the file exist — and the only thing that reaches stdout
 * is the verdict. So `pnpm exercises` is safe to run mid-session, and safe for a
 * model to run, which the files themselves are not (`rules/no-spoilers.md`).
 *
 * Two severities, and the distinction is the useful part:
 *
 * - **broken** — the exercise cannot be drilled as specified. A missing suite, a
 *   `meta.yaml` whose `pattern:` disagrees with its own directory, a README that
 *   names its own pattern.
 * - **unauthored** — the exercise works, but an optional part was never written.
 *   Hint rungs 1 and 3 come from `meta.yaml`, and `pnpm drill` already says so
 *   rather than serving the next rung up; this counts them instead of letting the
 *   gap be discovered one drill at a time.
 *
 * Exit code is 1 only for broken. An unauthored count is a to-do list, not a
 * failure, and a script that failed CI over it would get ignored.
 */

const ROOT = process.cwd()

type Severity = 'broken' | 'unauthored'

interface Finding {
  severity: Severity
  where: string
  what: string
}

const findings: Finding[] = []

/**
 * Lines that need a human's judgement rather than a verdict. Printed under the
 * counts and never affecting the exit code — see `danglingLiterals`.
 */
const inventory: string[] = []

function broken(where: string, what: string): void {
  findings.push({ severity: 'broken', where, what })
}

function unauthored(where: string, what: string): void {
  findings.push({ severity: 'unauthored', where, what })
}

function dirs(relPath: string): string[] {
  const full = join(ROOT, relPath)
  if (!existsSync(full)) return []
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function read(relPath: string): string | null {
  try {
    return readFileSync(join(ROOT, relPath), 'utf8')
  } catch {
    return null
  }
}

function requireFile(where: string, relPath: string, note = ''): string | null {
  const body = read(relPath)
  if (body === null) {
    broken(where, `missing ${relPath}${note ? ` — ${note}` : ''}`)
    return null
  }
  if (body.trim() === '') {
    broken(where, `${relPath} is empty`)
    return null
  }
  return body
}

/** A top-level `key:` value from a meta.yaml. Nested keys are deliberately not matched. */
function field(yaml: string, key: string): string | null {
  const match = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(yaml)
  const value = match?.[1]?.trim()
  return value === undefined || value === '' ? null : value
}

/** Whether a `key:` exists at all, including as the header of a nested block or list. */
function hasKey(yaml: string, key: string): boolean {
  return new RegExp(`^${key}:`, 'm').test(yaml)
}

/** A nested `parent:` / `  child:` value — how `hints.nudge` and `complexity.time` are written. */
function nested(yaml: string, parent: string, child: string): string | null {
  const block = new RegExp(`^${parent}:\\s*\\n((?:[ \\t]+.*\\n?)*)`, 'm').exec(yaml)
  if (!block?.[1]) return null
  const match = new RegExp(`^[ \\t]+${child}:\\s*(.*)$`, 'm').exec(block[1])
  const value = match?.[1]?.trim()
  return value === undefined || value === '' ? null : value
}

const DIFFICULTIES = ['warmup', 'easy', 'medium', 'hard']

/**
 * Words that would name a pattern if they appeared in its own README.
 *
 * From the directory name, which *is* the pattern. Single-word fragments are
 * dropped: `problems/elimination/celebrity` would otherwise flag the word
 * "elimination" appearing in ordinary prose, and a checker that cries wolf on
 * every README gets switched off. Two-word-or-longer patterns are the ones worth
 * catching, because "monotonic stack" in a prompt is the answer.
 */
function patternPhrases(pattern: string): string[] {
  const words = pattern.split('-')
  if (words.length < 2) return []
  return [pattern, words.join(' ')]
}

// ---------------------------------------------------------------------------
// problems/ — the coding drills
// ---------------------------------------------------------------------------

/**
 * A cost mechanism, spotted by the names the two documented ones are built from.
 *
 * `.claude/CLAUDE.md`: a drill is only worth doing if a correct but brute-force
 * solution fails it, by an oracle budget (`assertWithinBudget`) or a scale test
 * (an explicit `elapsed` assertion, because the `testTimeout` provably does not
 * enforce it). Presence of the name is not proof the assertion is right — only
 * that the suite has teeth of the documented kind, which is what an inventory can
 * honestly check.
 */
function hasCostMechanism(suite: string): boolean {
  return /assertWithinBudget|elapsed/.test(suite)
}

interface ProblemRow {
  pattern: string
  slug: string
  difficulty: string
  cost: boolean
  hints: number
  complexity: boolean
  worked: boolean
}

function checkProblems(): ProblemRow[] {
  const rows: ProblemRow[] = []
  const patternsMd = read('patterns.md')
  if (patternsMd === null) broken('patterns.md', 'missing — every pattern row lives here')

  for (const pattern of dirs('problems')) {
    for (const slug of dirs(`problems/${pattern}`)) {
      const dir = `problems/${pattern}/${slug}`
      const where = `problems/${pattern}/${slug}`

      const meta = requireFile(where, `${dir}/meta.yaml`)
      const readme = requireFile(where, `${dir}/README.md`, 'the prompt')
      const stub = requireFile(where, `${dir}/stub.ts`, 'the pristine starting point for pnpm reset')
      requireFile(where, `${dir}/solution.ts`, 'his working file')
      const suite = requireFile(where, `${dir}/solution.test.ts`, 'the objective standard')

      // "Ships red" means something specific per track: a coding stub throws.
      // A stub that returned a plausible value would make the first test run a
      // lie about where he is starting from.
      if (stub && !/not implemented/i.test(stub)) {
        broken(where, 'stub.ts does not throw "not implemented" — a coding stub has to ship red')
      }

      // The prompt must never name the pattern — rules/no-spoilers.md, and the
      // reason the whole `problems/<pattern>/<slug>` path stays server-side.
      // A pattern that is also the subject of the question — "reverse a linked
      // list" — cannot be asked without naming it. No checker can tell that case
      // from a leak, so the exercise declares it and this honours the declaration.
      // An undeclared match is still broken, which keeps the default strict.
      const declaredInPrompt = meta !== null && field(meta, 'pattern-in-prompt') === 'accepted'
      if (readme && !declaredInPrompt) {
        for (const phrase of patternPhrases(pattern)) {
          if (readme.toLowerCase().includes(phrase)) {
            broken(
              where,
              `README.md contains "${phrase}" — the prompt must never name its pattern. ` +
                'If the pattern is the subject of the question, declare pattern-in-prompt: accepted in meta.yaml.',
            )
          }
        }
      }

      const difficulty = meta ? field(meta, 'difficulty') : null
      if (meta) {
        const declared = field(meta, 'pattern')
        if (declared === null) broken(where, 'meta.yaml has no pattern:')
        else if (declared !== pattern) {
          broken(where, `meta.yaml says pattern: ${declared} but it lives under ${pattern}`)
        }
        if (field(meta, 'title') === null) broken(where, 'meta.yaml has no title:')
        if (difficulty === null) broken(where, 'meta.yaml has no difficulty:')
        else if (!DIFFICULTIES.includes(difficulty)) {
          broken(where, `meta.yaml difficulty: ${difficulty} is not one of ${DIFFICULTIES.join(', ')}`)
        }
        if (!hasKey(meta, 'budget')) unauthored(where, 'meta.yaml has no budget: line')
      }

      // The warm-up tier is a documented exemption from the cost rule, and the
      // exemption has to be visible in all three places or a drill that silently
      // lacks teeth is indistinguishable from a broken suite.
      const isWarmup = difficulty === 'warmup'
      const cost = suite ? hasCostMechanism(suite) : false
      if (suite && !isWarmup && !cost) {
        broken(
          where,
          'no assertWithinBudget and no elapsed assertion — a brute force would pass this, ' +
            'and only difficulty: warmup is exempt',
        )
      }
      if (suite && isWarmup && !/correctness[- ]only/i.test(suite)) {
        broken(where, 'a warm-up suite must say in a comment that it is correctness-only, and why')
      }
      if (readme && isWarmup && !/no hidden cost trap/i.test(readme)) {
        broken(where, "a warm-up README must say there is no hidden cost trap")
      }

      // Authored hint rungs. Rungs 2 and 4 need no authoring (the pattern name; the
      // solutions file), so only 1 and 3 are counted here.
      let hints = 0
      if (meta) {
        if (nested(meta, 'hints', 'nudge')) hints += 1
        if (nested(meta, 'hints', 'approach')) hints += 1
      }
      const complexity = meta !== null && nested(meta, 'complexity', 'time') !== null

      const worked = existsSync(join(ROOT, `solutions/${pattern}/${slug}.md`))
      if (!worked) {
        broken(where, `no worked answer at solutions/${pattern}/${slug}.md — /review has nothing to read`)
      }

      rows.push({ pattern, slug, difficulty: difficulty ?? '—', cost, hints, complexity, worked })
    }

    // A pattern with no row in patterns.md has no tell and no insight written
    // down, so /coach and the between-session reading skip it silently. Checked by
    // substring, never by printing: this file states the answer to every problem.
    if (patternsMd !== null && !patternsMd.includes(pattern)) {
      unauthored('patterns.md', `no row mentioning "${pattern}"`)
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// debugging/ and feature/ — the two-suite tracks
// ---------------------------------------------------------------------------

/**
 * Ids the **bug report** names that appear nowhere in the exercise's source.
 *
 * **Information, not a finding**, and narrowed hard to stay worth reading. The
 * broad version — every literal in the suites that is missing from `src/` — was
 * tried first and produced forty entries for one feature exercise, because those
 * tests legitimately construct their own inputs. Noise gets a check switched off.
 *
 * What is left is the case that actually confused a real drill: the report is
 * written as though a whole system stood behind it, naming an account or an id,
 * and the fixture does not contain that id at all. In `entitlements-gate` that is
 * `cust_48213` — deliberate, since both suites' third test is "when the customer
 * entitlements cannot be resolved", and absence is how that state is expressed.
 * Deliberate or not, it is where "this exercise is incomplete" comes from, so it
 * gets printed and a human decides.
 */
function reportedButAbsent(dir: string, suites: string[]): string[] {
  const srcDir = join(ROOT, dir, 'src')
  if (!existsSync(srcDir)) return []
  const source = readdirSync(srcDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => read(`${dir}/src/${name}`) ?? '')
    .join('\n')

  const readme = read(`${dir}/README.md`)
  if (!readme) return []

  const referenced = new Set<string>()
  for (const suite of suites) {
    const body = read(`${dir}/${suite}`)
    if (!body) continue
    for (const match of body.matchAll(/['"`]([^'"`\s]{3,})['"`]/g)) {
      const literal = match[1]!
      // Import specifiers are not data.
      if (literal.startsWith('.') || literal === 'vitest') continue
      referenced.add(literal)
    }
  }
  // The intersection with the report is the whole point: a literal only the tests
  // know about is a test's own input, and a literal the report names is a promise
  // about the world.
  return [...referenced].filter((literal) => readme.includes(literal) && !source.includes(literal)).sort()
}

function checkTwoSuiteTrack(
  track: 'debugging' | 'feature',
  suites: [string, string],
  extras: string[],
): string[] {
  const names = dirs(track)
  for (const name of names) {
    const dir = `${track}/${name}`
    const where = dir
    requireFile(where, `${dir}/README.md`, track === 'debugging' ? 'the bug report' : 'the brief')
    for (const suite of suites) requireFile(where, `${dir}/${suite}`)
    for (const extra of extras) requireFile(where, `${dir}/${extra}`)

    const meta = requireFile(where, `${dir}/meta.yaml`)
    if (meta) {
      if (field(meta, 'title') === null) broken(where, 'meta.yaml has no title:')
      // The domains list is what `pnpm domains --for <company>` joins against.
      // Without it the exercise is invisible to tailoring.
      if (!hasKey(meta, 'domains')) broken(where, 'meta.yaml has no domains: list')
    }

    const srcDir = join(ROOT, dir, 'src')
    if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
      broken(where, 'missing src/ — there is no code to work on')
    } else if (readdirSync(srcDir).filter((f) => f.endsWith('.ts')).length === 0) {
      broken(where, 'src/ holds no TypeScript')
    }

    if (track === 'debugging' && !existsSync(join(ROOT, `solutions/debugging/${name}.md`))) {
      broken(where, `no worked answer at solutions/debugging/${name}.md`)
    }

    // Debugging only. A feature brief names example data because it is describing
    // what to build, and the tests create it — `menu-modifiers`' report mentions
    // "Cheeseburger" and no fixture should contain one. A bug report is the other
    // way round: it describes a system that already exists, and `src/` is that
    // system, so a named id missing from it is worth a second look.
    const absent = track === 'debugging' ? reportedButAbsent(dir, suites) : []
    if (absent.length > 0) {
      inventory.push(`  ${dir}: the report names ${absent.join(', ')}, and src/ has no such id`)
    }
  }
  return names
}

// ---------------------------------------------------------------------------
// system-design/
// ---------------------------------------------------------------------------

function checkDesigns(): string[] {
  const names = dirs('system-design')
  for (const name of names) {
    const dir = `system-design/${name}`
    requireFile(dir, `${dir}/README.md`, 'the prompt')
    requireFile(dir, `${dir}/rubric.md`, 'the dimensions the drill is scored against')
    requireFile(dir, `${dir}/reference.md`, 'the worked design /review reads')
    const meta = read(`${dir}/meta.yaml`)
    if (meta === null) {
      broken(dir, 'missing meta.yaml — no domains, so pnpm domains cannot see it')
      continue
    }
    if (field(meta, 'title') === null) broken(dir, 'meta.yaml has no title:')
    if (!hasKey(meta, 'domains')) broken(dir, 'meta.yaml has no domains: list')
  }
  return names
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const problems = checkProblems()
const debugging = checkTwoSuiteTrack('debugging', ['repro.test.ts', 'invariant.test.ts'], [])
const features = checkTwoSuiteTrack('feature', ['regression.test.ts', 'feature.test.ts'], ['rubric.md'])
const designs = checkDesigns()

const byTier = DIFFICULTIES.map(
  (tier) => `${tier} ${problems.filter((row) => row.difficulty === tier).length}`,
).join(', ')

console.log(`problems      ${problems.length} across ${new Set(problems.map((r) => r.pattern)).size} patterns (${byTier})`)
console.log(`  cost gap    ${problems.filter((r) => r.cost).length} enforce one, ${problems.filter((r) => r.difficulty === 'warmup').length} exempt as warm-ups`)
console.log(`  hint rungs  ${problems.filter((r) => r.hints === 2).length} fully authored, ${problems.filter((r) => r.hints === 1).length} partly, ${problems.filter((r) => r.hints === 0).length} not at all`)
console.log(`  complexity  ${problems.filter((r) => r.complexity).length} authored`)
console.log(`  worked      ${problems.filter((r) => r.worked).length} have a solutions/ file`)
console.log(`debugging     ${debugging.length}`)
console.log(`feature       ${features.length}`)
console.log(`system-design ${designs.length}`)

const brokenFindings = findings.filter((f) => f.severity === 'broken')
const unauthoredFindings = findings.filter((f) => f.severity === 'unauthored')

for (const [label, list] of [
  ['BROKEN — cannot be drilled as specified', brokenFindings],
  ['unauthored — works, but a part was never written', unauthoredFindings],
] as const) {
  if (list.length === 0) continue
  console.log(`\n${label} (${list.length})`)
  for (const finding of list) console.log(`  ${finding.where}: ${finding.what}`)
}

if (inventory.length > 0) {
  console.log(
    '\nfor your judgement — usually deliberate (absence is a state under test), but this is\n' +
      'where "this exercise is incomplete" comes from',
  )
  for (const line of inventory) console.log(line)
}

if (brokenFindings.length === 0) {
  console.log('\nNothing broken.')
}

process.exit(brokenFindings.length === 0 ? 0 : 1)
