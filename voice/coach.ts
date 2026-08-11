import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProblemLocation } from './problems'

/**
 * The coaching track: pair programming out loud, with the answers on the table.
 *
 * Everything here is the inverse of a drill, and that is why it lives in its own
 * file rather than as a fourth branch of `context.ts`.
 *
 * **It is a separate door, not the drill door with the lock off.**
 * `assertNoSpoilers` is a runtime invariant whose own comment says it "does not
 * trust its callers" — it throws on `solutions/`, `patterns.md` and
 * `reference.md`. Coaching needs exactly those files. The tempting change is a
 * track exemption inside that guard, which would turn one absolute rule into a
 * conditional one; conditional safety gates are how leaks happen, because the
 * condition is one refactor away from being wrong. So the guard is untouched,
 * `allowedPaths` refuses this track outright, and coaching reads its files
 * through `coachPaths` below — visibly a different thing rather than a drill with
 * the safety off. `coach.test.ts` asserts both halves: that `assertNoSpoilers`
 * still rejects every path coaching reads, and that the drill door still refuses
 * to open for it.
 *
 * **Nothing is rationed.** The hint ladder exists because help *during* an
 * attempt has to cost something. Coaching happens after one, so there is no
 * ladder, no rung count, no score and no verdict — `AGENTS.md`: "help
 * after one is complete and unrationed".
 */

/**
 * The files a coach reads. Every one of them is a spoiler, on purpose.
 *
 * `solution.test.ts` is included, unlike in a drill, because half of pairing on a
 * failing suite is reading the test that is failing. `meta.yaml` is included for
 * the same reason it is excluded from a drill — it names the pattern in a field,
 * and here that is the subject rather than the answer.
 */
export function coachPaths(problem: ProblemLocation): string[] {
  const dir = `problems/${problem.pattern}/${problem.slug}`
  return [
    `${dir}/README.md`,
    `${dir}/solution.test.ts`,
    `${dir}/meta.yaml`,
    `solutions/${problem.pattern}/${problem.slug}.md`,
    'patterns.md',
  ]
}

/** Where a coaching transcript lands. Separate from `local/drills/` — it is not an attempt. */
export function coachTranscriptDir(): string {
  return 'local/coaching'
}

/**
 * The candidate's working file, as a cue the coach is told and never speaks.
 *
 * This is what makes it pairing rather than another interview: a pair reads your
 * screen. The mechanism is the one the repo already uses twice — the design
 * track's time check and the coding track's test verdict both arrive in the slot
 * where everything else is the candidate speaking, framed as an aside so a model
 * cannot mistake them for something he said.
 *
 * Re-sent every turn, which is the cost: the file grows and so does the per-turn
 * spend. That is the right trade for a coach that can see the code, and it is
 * also why the empty case is stated explicitly rather than omitted — a coach that
 * silently receives nothing will start guessing at code that is not there.
 */
export function codeCue(source: string | null): string {
  if (source === null) {
    return (
      '[For you only, not spoken: his working file could not be read. Do not guess at ' +
      'what it contains and do not describe code you have not seen — ask him what he has ' +
      'so far.]'
    )
  }
  if (source.trim() === '') {
    return '[For you only, not spoken: his working file is currently empty. He has not started writing yet.]'
  }
  return [
    '[For you only, not spoken: this is his working file as it stands right now.',
    'It is the current state, not a message from him — do not read it aloud, do not',
    'quote it back at length, and do not react to it unless it is relevant to what',
    'he just said.]',
    '',
    '```ts',
    source,
    '```',
  ].join('\n')
}

/** Reads `solution.ts`, or null if it is missing. Null is a real state — `pnpm reset` deletes nothing else. */
export function readWorkingFile(root: string, problem: ProblemLocation): string | null {
  const path = join(root, 'problems', problem.pattern, problem.slug, 'solution.ts')
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * The coach's system prompt.
 *
 * Deliberately not built by `buildSystemPrompt`: that function calls
 * `allowedPaths` and then `assertNoSpoilers`, and both must keep refusing this
 * track. See the file comment.
 */
export function buildCoachPrompt(root: string, problem: ProblemLocation): string {
  const sections = coachPaths(problem).map((path) => {
    const full = join(root, path)
    if (!existsSync(full)) {
      // A missing worked solution is the one that matters: a coach without it is
      // an interviewer that has been told it may talk freely, which is worse
      // than either mode done properly.
      throw new Error(`Cannot coach "${problem.slug}": missing ${path}`)
    }
    return `<file path="${path}">\n${readFileSync(full, 'utf8')}\n</file>`
  })

  return [
    ...sections,
    '<role>',
    'You are pairing with an engineer on this problem. You are not interviewing him',
    'and you are not scoring him. There is no clock, no hint ladder and no verdict.',
    '',
    'You have the worked solution and the pattern notes above, and you may use all',
    'of it. Answer directly when he asks something; if he is stuck, say the thing',
    'that unsticks him rather than a question designed to make him find it. That is',
    'the whole difference between this and a drill, and being coy here wastes his',
    'time — a drill is where he earns it.',
    '',
    'Teach the pattern, not just this problem: the tell that should make him reach',
    'for it, the insight it turns on, what it costs, and where it stops working.',
    'When he has working code, say what you would change and why.',
    '</role>',
    '<voice-mode>',
    'This is spoken aloud. Your text is read by a speech synthesiser and heard, not',
    'seen. Write plain prose only: no markdown, no bullet lists, no code blocks, no',
    'headings. Numbers, symbols and operators must be spelled the way you would say',
    'them — "O of n", not "O(n)".',
    '',
    // The same omission that produced a third-person interview on the coding
    // track — see the note in voice/context.ts's voice-mode. It matters more here:
    // pairing is a conversation, and a coach narrating him to an absent third
    // party is not one.
    'Speak to him directly, in the second person. The material above talks about',
    'him as "he" because it is written for you rather than for him — you are',
    'talking to him, so say "you". Never narrate him in the third person and never',
    'address anyone else.',
    '',
    'You have no tools and no file access. Everything you are permitted to know is',
    'above, plus his working file, which you are shown each turn.',
    '',
    'Because you cannot show him code, describe it in words he can type. Name the',
    'variable, say what it starts as, say what happens to it in the loop. A spoken',
    'code block is unusable.',
    '',
    'You may ask more than one thing per turn and he may interrupt you — this is a',
    'conversation between two people looking at the same code, not a turn-based',
    'interview. Keep each turn short enough to be listened to; if you have four',
    'things to say, say the first and let him answer.',
    '</voice-mode>',
  ].join('\n')
}
