import { existsSync, readFileSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'

/**
 * `coach` is not a drill. It is included here because a session, a transcript and
 * a route all need to name it, but every spoiler guard in this file refuses it —
 * `allowedPaths` throws, and therefore so does `buildSystemPrompt`. Coaching
 * reads its files through `voice/coach.ts`, which explains why that is a separate
 * door rather than an exemption inside this one.
 */
export type Track = 'mock' | 'design' | 'coding' | 'coach'

/**
 * Paths the interviewer must never see. `.claude/rules/no-spoilers.md` states
 * these as instructions to a reader; here they are a runtime invariant, because
 * a drill is destroyed the moment the answer enters context. Case-insensitive:
 * macOS filesystems are case-insensitive by default, so `Patterns.MD` must be
 * caught too.
 */
const DENIED = [/^solutions\//i, /^patterns\.md$/i, /(^|\/)reference\.md$/i]

/**
 * Throw if any path is a spoiler. Called on every allowlist before it is read,
 * so widening the allowlist by mistake fails loudly instead of silently leaking.
 *
 * This is the last line of defence, so it does not trust its callers: every
 * path is normalized before being tested against `DENIED`, and any path that
 * is absolute or escapes upward (a `..` segment surviving normalization) is
 * rejected outright, whether or not it happens to match a `DENIED` pattern.
 */
export function assertNoSpoilers(paths: string[]): void {
  for (const path of paths) {
    const normalized = normalize(path)
    const segments = normalized.split(sep)
    const escapesRoot = normalized.startsWith('/') || segments.includes('..')
    if (escapesRoot || DENIED.some((pattern) => pattern.test(normalized))) {
      throw new Error(`Refusing to read spoiler file into an interview: ${path}`)
    }
  }
}

/**
 * A problem name is a plain slug and nothing else. Exported so every guard in
 * the codebase tests against this exact rule: it is duplicated nowhere, because
 * two copies of a security guard drift and only one of them gets tightened.
 */
export const PROBLEM_SLUG = /^[a-z0-9-]+$/

/**
 * The files an interviewer for this drill is allowed to read.
 *
 * `pattern` applies to the coding track only, where a problem's directory is
 * `problems/<pattern>/<slug>`. It is validated like every other segment, and it
 * must come from resolving a slug against disk (`problems.ts`) rather than from
 * a client — the client never sends a pattern, because the pattern is the answer.
 */
export function allowedPaths(track: Track, problem?: string, pattern?: string): string[] {
  // The drill door does not open for coaching, and says so rather than falling
  // through to some track's list. A coach reads `solutions/`, `patterns.md` and
  // the suite; handing those to this function would mean `assertNoSpoilers` had
  // to be taught an exception, and an exception in a guard that "does not trust
  // its callers" is the guard being wrong for one caller.
  if (track === 'coach') {
    throw new Error('The coach track does not use allowedPaths — see coachPaths in voice/coach.ts.')
  }
  if (track === 'mock') {
    return [
      '.claude/commands/mock.md',
      'behavioral/competencies.md',
      'behavioral/questions.md',
    ]
  }
  if (!problem) throw new Error(`A ${track} drill needs a problem name.`)
  if (!PROBLEM_SLUG.test(problem)) {
    throw new Error(`Invalid problem name: ${problem}`)
  }
  if (track === 'coding') {
    if (!pattern) throw new Error('A coding drill needs its resolved pattern.')
    if (!PROBLEM_SLUG.test(pattern)) {
      throw new Error(`Invalid pattern name: ${pattern}`)
    }
    // No `solution.test.ts`: the suite is the objective standard and the
    // interviewer does not need to read it to use it — `pnpm test` reports the
    // verdict. Its comments explain fixture construction, and they have leaked
    // an approach once already. No `meta.yaml` either; it names the pattern in a
    // field, and the pattern reaches the prompt deliberately and once, below.
    return ['.claude/commands/drill.md', `problems/${pattern}/${problem}/README.md`]
  }
  return [
    '.claude/commands/design.md',
    `system-design/${problem}/README.md`,
    `system-design/${problem}/rubric.md`,
  ]
}

function headings(markdown: string): string[] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim())
}

/**
 * Which competencies have a story and which do not — headings only.
 *
 * `mock.md` says to consult the story bank *only* to find gaps, never to read
 * the story being asked for. Parsing headings makes that mechanical: the bodies
 * never leave this function.
 */
export function competencyCoverage(root: string): { all: string[]; covered: string[] } {
  const all = headings(readFileSync(join(root, 'behavioral/competencies.md'), 'utf8'))
  const bank = join(root, 'local/stories.md')
  const covered = existsSync(bank) ? headings(readFileSync(bank, 'utf8')) : []
  return { all, covered }
}

/**
 * @param focus For the behavioural track only: one competency title to drill,
 *   when the candidate picked one instead of leaving the choice open. Passed as
 *   the authored title rather than a slug — `voice/competencies.ts` owns that
 *   mapping, and the prompt should name the competency the way the file does.
 */
export function buildSystemPrompt(
  root: string,
  track: Track,
  problem?: string,
  pattern?: string,
  focus?: string,
): string {
  const paths = allowedPaths(track, problem, pattern)
  assertNoSpoilers(paths)

  const sections = paths.map((path) => {
    const full = join(root, path)
    if (!existsSync(full)) {
      const label = problem ? ` "${problem}"` : ''
      throw new Error(`Unknown problem${label}: missing expected file ${path}`)
    }
    return `<file path="${path}">\n${readFileSync(full, 'utf8')}\n</file>`
  })

  if (track === 'mock') {
    const { all, covered } = competencyCoverage(root)
    const lines = all.map((c) => `- ${c}${covered.includes(c) ? '' : ' (no story yet)'}`)
    sections.push(`<competency-coverage>\n${lines.join('\n')}\n</competency-coverage>`)

    if (focus) {
      // Named, but the phrasing is still the interviewer's to choose from the
      // bank — "drill this competency" is deliberate practice, while "ask me
      // this exact question" would remove the recall the drill is for. The
      // instruction not to announce it matters for the same reason: he picked a
      // competency, and hearing it read back as a label turns a question into a
      // form to fill in.
      sections.push(
        [
          '<focus>',
          `He has asked to drill this competency: ${focus}`,
          'Choose phrasings for it from the question bank above and stay on it for',
          'the session. Do not announce the competency by name or say that he',
          'chose it — ask the question as an interviewer would.',
          '</focus>',
        ].join('\n'),
      )
    }
  }

  const voiceMode = [
    '<voice-mode>',
    'This interview is spoken aloud. Your text is read by a speech synthesiser',
    'and heard, not seen. Write plain prose only: no markdown, no bullet lists,',
    'no code blocks, no headings. Numbers and symbols must be spelled the way',
    'you would say them.',
    '',
    // Stated because it was not, and a real drill on 2026-08-10 was conducted in
    // the third person: "He said the text reads the same forwards and backwards
    // ... Where do those fit into what he just told me?" — spoken aloud, to him.
    // Everything above this line, including these instructions and the bracketed
    // cues, discusses him as "he" because it is written *about* the drill; only
    // this says which voice to answer in. Inferring it worked until the model
    // changed, which is another way of saying it was never specified.
    'Speak to him directly, in the second person, the whole way through. The',
    'material above talks about him as "he" because it is written for you rather',
    'than for him — you are talking to him, so say "you". Never narrate him in',
    'the third person, never address a third party, and never describe what he',
    'said as though reporting it to someone else. That includes your closing',
    'verdict, which he hears: it is said to him, not written about him.',
    '',
    'You have no tools and no file access. Everything you are permitted to know',
    'is above. Do not ask for a file and do not claim to have read one.',
    '',
    'Ask exactly one question per turn. He is listening, not reading, and cannot',
    'look back at what you said. A two-part question loses its second part, so',
    'asking one and then faulting him for missing it tests his short-term memory',
    'for spoken lists rather than his engineering. If a turn raises two things',
    'worth asking, ask the more important one and keep the other for later. Never',
    'say that you asked something he did not answer if it arrived attached to',
    'another question.',
  ]

  if (track === 'mock') {
    voiceMode.push(
      '',
      'Step 6 above tells you to append to local/stories.md. You cannot write',
      'files, so replace that step: after you critique a behavioral answer, end',
      'your turn with this block, exactly as shown, in place of the file write:',
      '',
      '```story-log',
      'competency: <the competency>',
      'story: <the story he used>',
      'worked: <what worked>',
      'fix: <the one thing to fix>',
      '```',
      '',
      'This is the one exception to no code blocks. It is stripped before your',
      'words reach him — do not speak it, name it, or introduce it.',
    )
  }

  if (track === 'coding') {
    // The pattern, stated once and deliberately. The interviewer needs it to be
    // able to give rung 2 of the hint ladder ("the pattern name, and nothing
    // else") — an interviewer that does not know the answer cannot ration it.
    // Everything about not volunteering it is in drill.md and restated below.
    sections.push(`<pattern>${pattern}</pattern>`)
  }

  if (track === 'design' || track === 'coding') {
    voiceMode.push(
      '',
      'You are holding the clock, so you are responsible for how it is spent. If',
      'a single sub-question has taken more than about four minutes and he is',
      'still circling it, give him the answer in one sentence and move on. Do not',
      'let him spend a quarter of the interview on one point and then tell him he',
      'has spent too long on it — that outcome was yours to prevent.',
    )
  }

  if (track === 'design') {
    // design.md's live mode step 6 ends by saving the transcript and score to
    // local/designs/. You cannot write files, and the same gap on the mock
    // track (a step whose file write was never replaced with anything) left the
    // whole scoring step quietly undone. The server persists everything spoken,
    // so the replacement is simply: say it.
    voiceMode.push(
      '',
      'Step 6 above tells you to save the transcript and score to a file. You',
      'cannot write files, and you do not need to — everything you say is being',
      'recorded and saved for him. So when time is up, deliver the score out',
      'loud as your final turn: each rubric dimension and its rating, the',
      'evidence in his own words, the weakest dimension, and one next action.',
      '',
      'You have no clock of your own. Each turn you are given is preceded by a',
      'time check telling you how long remains. Trust it over your own sense of',
      'how long the conversation feels, and treat the time check as instruction',
      'to you, not as something he said — never read it aloud or refer to being',
      'told it.',
    )
  }

  if (track === 'coding') {
    // drill.md is written for a chat session with file tools: it says to run
    // `pnpm reset`, paste the README, start a timer, run `pnpm test`, and append
    // to the drill log. None of that is available here, and leaving those steps
    // unreplaced is exactly how the mock track's whole story-log step ended up
    // silently undone. So each one is reassigned below to what actually happens.
    voiceMode.push(
      '',
      'You have no clock, no terminal and no files. What drill.md asks you to do',
      'yourself is done for you instead:',
      '',
      'Step 2, pasting the README: he can already see the problem on screen. Do',
      'not read it out. Open by asking him to tell you what the problem is asking',
      'for, in his own words.',
      '',
      'Step 3, starting a timer: the clock runs on screen, and each turn you are',
      'given is preceded by a time check. Treat that as instruction to you, not',
      'as something he said — never read it aloud.',
      '',
      'Step 7, running the tests: he runs them, and you are given the result the',
      'same way, as a bracketed note. React to it as an interviewer would.',
      '',
      'The drill log: you cannot write it directly, but it does get written. Say',
      'your verdict out loud as your closing turn — solved or not, and the one',
      'thing that actually went wrong — and then end that final turn with this',
      'block, exactly as shown:',
      '',
      '```drill-log',
      'solved: yes or no',
      'note: one line on what actually went wrong, not a grade',
      '```',
      '',
      'It is stripped before your words reach him — do not speak it, name it, or',
      'introduce it. Only these two fields: the date, the problem, the hint rung',
      'and the elapsed time are recorded for you and are not yours to state.',
      '',
      'He may ask for a hint. When he does you are given a bracketed note saying',
      'which rung to give; obey it exactly and never go past it. Do not offer a',
      'hint he has not asked for.',
      '',
      'He is typing code in his own editor while he talks. Long silences are him',
      'working, not him stuck: step 5 of drill.md still holds, and holds harder',
      'out loud than in writing. Do not fill a pause, do not ask how it is going,',
      'and do not comment on an attempt in progress.',
    )
  }

  voiceMode.push('</voice-mode>')
  sections.push(voiceMode.join('\n'))

  return sections.join('\n\n')
}

/** The hint ladder's rungs, per `.claude/rules/no-spoilers.md`. Index 0 is no help taken. */
export const HINT_RUNGS = [
  'no help taken',
  'a nudge, phrased as a question, that does not name the pattern',
  'the pattern name, and nothing else',
  'the approach in words — no code',
  'the full worked solution',
] as const

/** The last rung. Past this there is nothing left to give. */
export const MAX_HINT_RUNG = HINT_RUNGS.length - 1

/**
 * The cue that hands the interviewer exactly one rung of the hint ladder.
 *
 * The ladder is Andre's own rule and its whole value is that it is rationed: "advance
 * exactly one rung per request. Never two." A model asked for "a hint" reliably
 * over-delivers, so the rung is counted server-side and the cue states which one
 * is owed and quotes that rung's definition verbatim, rather than trusting the
 * interviewer to remember how many it has already given.
 *
 * Marked as an aside for the same reason the time check is: it arrives in the slot
 * where everything else is Andre speaking, and an interviewer that reads it out
 * would announce the rung it is about to give.
 */
export function hintCue(rung: number): string {
  if (rung >= MAX_HINT_RUNG) {
    return (
      `[Hint request, for you only: this is rung ${MAX_HINT_RUNG}, the last one — ${HINT_RUNGS[MAX_HINT_RUNG]}. ` +
      'Give it in full, then let him work. There is nothing further to ration, so do not withhold any of it.]'
    )
  }
  return (
    `[Hint request, for you only: give rung ${rung} and stop — ${HINT_RUNGS[rung]}. ` +
    'Exactly this rung, not the one above it, and nothing from any later rung. ' +
    'Do not announce which rung it is, do not say how many remain, and do not ask whether it helped.]'
  )
}

/**
 * The cue that asks a coding interviewer to close the drill out, now.
 *
 * Needed because the closing verdict and its `drill-log` trailer are instructed
 * for the interviewer's *final* turn, and `<voice-mode>` frames that as the moment
 * time runs out. Most drills do not run to time — he presses "End session" — and
 * without this the interviewer never gets a final turn, so the log row that
 * `/status` reads was written only for drills that went the full forty-five
 * minutes. That is the wrong half of the cases.
 */
export function closingCue(): string {
  return (
    '[For you only: he has ended the session, so this is your final turn. Close the ' +
    'drill out now exactly as your instructions say — your verdict out loud, then the ' +
    'drill-log block. Do not ask him anything; there will be no reply.]'
  )
}

/** The live design track's budget, per `design.md`: "45 minutes unless he says otherwise." */
export const DESIGN_BUDGET_MS = 45 * 60 * 1000

/**
 * The live coding track's budget.
 *
 * Unlike the design track's, this number is a **choice, not a quotation**:
 * `drill.md` step 3 says "start a timer" and never says how long. 45 minutes is
 * the length of the interview it is preparing him for, and matching the design
 * track keeps one budget rule across both timed tracks. Overridable per session
 * for the same reason design's is.
 */
export const CODING_BUDGET_MS = 45 * 60 * 1000

/**
 * The per-turn time check fed to a timed interviewer (see `CreateSessionOptions.turnCue`).
 *
 * Phrased as an instruction to the interviewer rather than as data, because it
 * arrives in the `user` slot where everything else is Andre speaking, and the
 * one failure that would ruin a drill is the interviewer reading it out as
 * though he had said it. The track's own prompt drives the behaviour — design.md
 * warns at ten minutes and stops at time; drill.md closes with a verdict — so
 * this only supplies the number, and states the deadline plainly at zero so
 * "at time, stop" has an unambiguous trigger.
 *
 * Shared by both timed tracks, which is why the closing instruction is generic:
 * each track's `<voice-mode>` already spells out what its own closing consists
 * of (a rubric score for design, a solved/not verdict for coding), and naming
 * one of them here would tell the other interviewer to deliver the wrong thing.
 */
export function timeCue(elapsedMs: number, budgetMs: number = DESIGN_BUDGET_MS): string {
  const remainingMs = budgetMs - elapsedMs
  if (remainingMs <= 0) {
    return '[Time check, for you only: time is up. Stop the interview now and close it out as your instructions say.]'
  }
  // Rounded up, so a cue never says "0 minutes remain" while time is still left.
  const minutes = Math.ceil(remainingMs / 60_000)
  const unit = minutes === 1 ? 'minute' : 'minutes'
  return `[Time check, for you only: ${minutes} ${unit} of the ${Math.round(budgetMs / 60_000)} remain.]`
}
