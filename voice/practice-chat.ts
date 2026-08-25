import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROBLEM_SLUG, assertNoSpoilers } from './context'
import { codingDocument } from './problems'
import type { ProblemLocation } from './problems'
import { stripSuiteComments } from './suite-comments'

/**
 * The tutor in practice mode.
 *
 * Three doors now read problem files, and they are three because their
 * allowlists genuinely differ rather than because nobody merged them:
 *
 * - `allowedPaths` (voice/context.ts) — a drill. No suite, no `meta.yaml`, no
 *   worked answer. The interviewer grades; it does not explain.
 * - `coachPaths` (voice/coach.ts) — pairing. *Every* file is a spoiler, on
 *   purpose, including `solutions/` and `patterns.md`.
 * - here — learning.
 *
 * ---
 *
 * **The rule this door enforces: the tutor knows nothing the learner cannot
 * already read.**
 *
 * That is not a slogan, it is checkable, and it decides every entry below.
 * `GET /api/coding/:slug/exercise` already ships the suite to the browser so
 * the Worker can grade it, so withholding those same bytes from a model the
 * browser is talking to protects nothing — anyone can read them in devtools —
 * while "why is this test failing?" is the most useful question a learner asks.
 * So the suite is in.
 *
 * But it goes through `stripSuiteComments` first, exactly as the browser's copy
 * does. Not for tidiness: four of the current suites name their own pattern
 * directory in a comment outright, which is hint rung 2 in plain text, and
 * `AGENTS.md` withholds this file from the interviewer because its fixture
 * comments have leaked an approach once already. Serving the raw file here
 * would hand the tutor a hint the learner's own devtools cannot show them —
 * breaking the rule in the one direction that matters.
 *
 * **`solution.ts` stays out, and not as secrecy theatre.** A capable model can
 * derive the answer and is allowed to — that is what a tutor is for, and this
 * is a learning mode, not a drill. The line is that it explains in its own
 * words rather than pasting the repo's finished file, which ends the exercise
 * instead of teaching it. `codingDocument` has no `solution` kind to ask for,
 * so that is unstateable here rather than merely stated.
 */
export function practiceChatPaths(problem: ProblemLocation): string[] {
  if (!PROBLEM_SLUG.test(problem.slug)) {
    throw new Error(`Invalid problem name: ${problem.slug}`)
  }
  if (!PROBLEM_SLUG.test(problem.pattern)) {
    throw new Error(`Invalid pattern name: ${problem.pattern}`)
  }
  const dir = `problems/${problem.pattern}/${problem.slug}`
  return [
    'prompts/practice-chat.md',
    `${dir}/README.md`,
    `${dir}/stub.ts`,
    `${dir}/solution.test.ts`,
  ]
}

/**
 * The candidate's editor buffer, as a cue rather than a file.
 *
 * Same mechanism `coach.ts` uses and for the same reason: the buffer does not
 * exist on disk in deployed mode, and even locally it changes between every
 * message. An allowlist is read once when the prompt is built; this arrives per
 * turn, which is the only way it can be current.
 *
 * Empty is said explicitly rather than omitted. A tutor that cannot tell "has
 * written nothing yet" from "the buffer was not sent" opens the same way on a
 * blank editor as on a nearly-finished one.
 */
export function codeCue(code: string): string {
  const trimmed = code.trim()
  if (trimmed === '') {
    return '<their-code>They have not written anything yet — the editor is still the stub.</their-code>'
  }
  return `<their-code>\n${trimmed}\n</their-code>`
}

/**
 * The tutor's system prompt.
 *
 * Goes through `assertNoSpoilers` — unlike `buildCoachPrompt`, which cannot,
 * because its whole list is spoilers. Keeping this one inside the guard is the
 * point: a later edit that adds `solutions/${pattern}/${slug}.md` to the list
 * above fails loudly here rather than quietly teaching from the answer key.
 *
 * The problem's own documents come through `codingDocument` rather than off
 * disk, so a deployed instance serves the copy `pnpm ingest` wrote rather than
 * whatever commit the container image happens to carry. The prompt file is read
 * from disk because it is not problem content — it is the same file for every
 * problem, and no ingest carries it.
 */
export function buildPracticeChatPrompt(root: string, problem: ProblemLocation): string {
  const paths = practiceChatPaths(problem)
  assertNoSpoilers(paths)

  const promptPath = join(root, 'prompts/practice-chat.md')
  if (!existsSync(promptPath)) {
    throw new Error('Cannot open practice chat: missing prompts/practice-chat.md')
  }

  const readme = codingDocument(root, problem, 'readme')
  const stub = codingDocument(root, problem, 'stub')
  const suite = codingDocument(root, problem, 'test')
  if (readme === null || stub === null || suite === null) {
    throw new Error(`Cannot open practice chat for "${problem.slug}": missing problem documents`)
  }

  const dir = `problems/${problem.pattern}/${problem.slug}`
  return [
    readFileSync(promptPath, 'utf8'),
    `<file path="${dir}/README.md">\n${readme}\n</file>`,
    `<file path="${dir}/stub.ts">\n${stub}\n</file>`,
    // Stripped, exactly as the browser's copy is. See the file comment.
    `<file path="${dir}/solution.test.ts">\n${stripSuiteComments(suite)}\n</file>`,
  ].join('\n\n')
}
