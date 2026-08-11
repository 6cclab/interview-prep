import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { readDrillLog } from '../voice/drill-log'
import { classifyFailures, runDrillTests, type DrillVerdict } from '../voice/drill-tests'
import { listCodingProblems, problemDir, stripPatternPaths, type CodingProblem } from '../voice/problems'
import { formatLogRow, readAuthored, resolveTarget, rungFor, selectByRust } from './drill-select'

/**
 * `pnpm drill [problem|pattern]` — a coding drill with no model involved.
 *
 * The same drill `prompts/drill.md` describes, run by a script. It
 * presents the problem cold, asks for the brute force before you write anything,
 * rations hints one rung per request, runs the suite, distinguishes the two kinds
 * of red, asks for complexity before confirming a green, and appends a log row.
 *
 * **What it does not do is judge prose.** It will not tell you whether your brute
 * force was right, whether your complexity answer is correct beyond comparing it
 * to an authored string, or write the log note for you. Those are the parts that
 * need a model, and inventing a scripted opinion about them would be worse than
 * having none: a wrong grade you cannot argue with teaches the wrong thing. So it
 * asks, records what you said, and leaves the assessment to you or to `/review`
 * later.
 *
 * Runs on any machine with Node and pnpm. No API key, no network, no audio.
 */

const HINT_LADDER_MAX = 4

function print(text = ''): void {
  process.stdout.write(`${text}\n`)
}

/** The prompt, and nothing else. Never the path — the path contains the pattern. */
function showProblem(dir: string): void {
  const readme = join(dir, 'README.md')
  if (!existsSync(readme)) {
    print('This problem has no README.md, which is a packaging bug rather than part of the drill.')
    return
  }
  print()
  print(readFileSync(readme, 'utf8').trimEnd())
  print()
}

/**
 * A red, said out loud the way `drill.md` insists on.
 *
 * The two reds mean opposite things: a correctness failure is a wrong answer, a
 * cost failure is a *right* answer that costs too much. Collapsing them into
 * "failed" is the single thing that command spends the most words forbidding, so
 * it is spelled out here rather than left to a reader to infer from test names.
 */
function reportVerdict(verdict: DrillVerdict): void {
  switch (verdict.kind) {
    case 'green':
      print('\nGreen. Everything passed.')
      return
    case 'correctness-red':
      print('\nCorrectness is red — the answer is wrong. Failing:')
      for (const name of verdict.failed) print(`  ${name}`)
      print('\nKeep going.')
      return
    case 'cost-red':
      print('\nCorrectness passed. Cost did not. Failing:')
      for (const name of verdict.failed) print(`  ${name}`)
      print(
        '\nThis is correct, and it is the brute force. In an interview this is the point where\n' +
          "you say \"that works, here's what it costs, let me do better\" — a working brute force\n" +
          'is a legitimate checkpoint, not a failed attempt.',
      )
      return
    case 'errored':
      print(`\nThe suite could not run at all: ${verdict.message}`)
      print('That is a compile or setup error rather than a wrong answer.')
      return
  }
}

function todayISO(): string {
  // Local date, not UTC: a drill at 9pm should log the day it felt like.
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Appends to `local/drill-log.md`, creating the table if `pnpm bootstrap` has not run. */
function appendLog(root: string, row: string): string {
  const path = join(root, 'local/drill-log.md')
  if (!existsSync(path)) {
    return `no ${path} — run \`pnpm bootstrap\` first; this attempt was not logged`
  }
  appendFileSync(path, `${row}\n`, 'utf8')
  return path
}

async function main(): Promise<void> {
  const root = process.cwd()
  const target = process.argv[2]
  const problems = listCodingProblems(root)
  if (problems.length === 0) {
    print('No problems found under problems/. Is this the repo root?')
    process.exit(1)
  }

  let problem: CodingProblem
  let why: string
  if (target) {
    const matches = resolveTarget(problems, target)
    if (matches.length === 0) {
      print(`No problem or pattern called "${target}".`)
      process.exit(1)
    }
    // A pattern with several problems still picks by rust within it, rather
    // than always handing over the same one.
    const picked = selectByRust(matches, readDrillLog(root))
    problem = picked?.problem ?? matches[0]!
    why = matches.length === 1 ? 'you asked for it' : `${picked?.why ?? 'first under that pattern'}`
  } else {
    const picked = selectByRust(problems, readDrillLog(root))
    if (!picked) {
      print('Nothing to drill.')
      process.exit(1)
    }
    problem = picked.problem
    why = picked.why
  }

  const dir = problemDir(problem)
  const authored = readAuthored(dir)
  const solutionPath = join(root, 'solutions', problem.pattern, `${problem.slug}.md`)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const started = Date.now()
  let rung = 0
  let bruteForce = ''

  try {
    print(`Drilling ${problem.slug} — ${why}.`)
    showProblem(dir)

    // Before anything is written. `drill.md`: naming the naive approach and its
    // cost out loud is what buys credit for the optimisation that follows, and
    // skipping it reads as luck or memorisation.
    print('Before you write anything: what is the obvious approach, and what does it cost?')
    bruteForce = (await rl.question('> ')).trim()
    if (bruteForce === '') {
      print('Nothing recorded. In a real interview this is free credit you just skipped.')
    }

    // `stripPatternPaths`, not the raw directory: `problems/<pattern>/<slug>/`
    // names the pattern, and the pattern is the answer. `drill.md` says not to
    // display the path for this reason, and the first run of this script printed
    // `problems/hashmap-counting/valid-anagram/solution.ts` — handing over rung 2
    // in the instructions for how to start.
    print(`\nWrite your answer in ${stripPatternPaths(`${dir}/solution.ts`)}. Then:`)
    print('  t  run the tests        h  hint (one rung)       c  complexity, then finish')
    print('  q  give up and log it   ?  show the problem again')

    for (;;) {
      const answer = (await rl.question('\ndrill> ')).trim().toLowerCase()

      if (answer === '?') {
        showProblem(dir)
        continue
      }

      if (answer === 'h') {
        if (rung >= HINT_LADDER_MAX) {
          print('The ladder is spent — rung 4 was the worked solution.')
          continue
        }
        rung += 1
        const next = rungFor(rung, { pattern: problem.pattern, hints: authored.hints, solutionPath })
        print(`\nRung ${rung} of 4:`)
        if (next.text) print(`  ${next.text}`)
        else if (next.file) print(readFileSync(next.file, 'utf8').trimEnd())
        else print(`  ${next.missing}`)
        // The count is printed every time so the cost of asking is legible when
        // you ask, rather than discovered in the log afterwards.
        print(`\nHints used: ${rung} of 4.`)
        continue
      }

      if (answer === 't') {
        print('\nRunning the suite…')
        const verdict = await runDrillTests({ root, problem })
        reportVerdict(verdict)
        continue
      }

      if (answer === 'c' || answer === 'q') {
        const gaveUp = answer === 'q'
        let solved = false

        if (!gaveUp) {
          const verdict = await runDrillTests({ root, problem })
          reportVerdict(verdict)
          solved = verdict.kind === 'green'
          if (!solved) {
            print('\nNot green, so this is not finished. Keep going, or `q` to log it unsolved.')
            continue
          }

          // Complexity before confirmation, always. Getting the right answer
          // while misreading its cost is the exact failure these drills exist
          // to catch.
          const time = (await rl.question('\nTime complexity? ')).trim()
          const space = (await rl.question('Space complexity? ')).trim()
          const expected = authored.complexity
          if (expected.time || expected.space) {
            print(`\nAuthored answer: time ${expected.time ?? '—'}, space ${expected.space ?? '—'}.`)
            print(`You said:        time ${time || '—'}, space ${space || '—'}.`)
            print('Compare them yourself — a string match is not a judgement of whether you were right.')
          } else {
            print('\nNo authored complexity for this problem, so there is nothing to check against.')
            print(`Recorded: time ${time || '—'}, space ${space || '—'}.`)
          }
        }

        const elapsedMs = Date.now() - started
        print(
          '\nOne line on what actually went wrong — not a grade. "Found the pass, forgot to verify"\nis useful; "good job" is not.',
        )
        const note = (await rl.question('> ')).trim()
        const row = formatLogRow({
          date: todayISO(),
          problem: problem.slug,
          pattern: problem.pattern,
          solved,
          // Giving up is logged at rung 4 whatever was actually asked: the answer
          // was handed over one way or another, and a generous rung here would
          // make `/status` read the log as fluency.
          hints: gaveUp ? HINT_LADDER_MAX : rung,
          elapsedMs,
          note,
        })
        const where = appendLog(root, row)
        print(`\n${row}`)
        print(`Logged to ${where}.`)
        if (bruteForce) print(`\nYour opening answer, for your own review: ${bruteForce}`)
        return
      }

      print('t = test, h = hint, c = complexity and finish, q = give up, ? = show the problem.')
    }
  } finally {
    rl.close()
  }
}

main().catch((error: unknown) => {
  print((error as Error).message)
  process.exit(1)
})
