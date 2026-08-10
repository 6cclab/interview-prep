import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The debugging exercise catalogue.
 *
 * Its own module rather than a branch inside `problems.ts`, because the two
 * tracks have opposite constraints and the difference is the interesting part.
 *
 * A coding problem lives at `problems/<pattern>/<slug>`, so its *path* is the
 * answer and `problems.ts` exists mainly to keep that path server-side. A
 * debugging exercise lives at `debugging/<exercise>` — one flat level, no
 * pattern, nothing in the path to hide. What it hides instead is the source: the
 * bug is planted in `debugging/<exercise>/src/**`, and the worked answer is
 * `solutions/debugging/<exercise>.md`, which `assertNoSpoilers` already denies
 * for every track by the `^solutions/` rule.
 *
 * `debug.md` does say not to *display* the exercise's file path, and this never
 * hands one out — the routes take a bare name, the same as every other track.
 * But the reason is weaker than the coding track's and worth stating so nobody
 * copies the wrong precaution: the name is a rough hint at the area, while a
 * coding problem's pattern is the whole solution. The bug report itself already
 * names the area in its first line.
 */

export interface Exercise {
  /** The directory name under `debugging/`, and what every route calls it. */
  name: string
  /** `meta.yaml`'s `title:` — the bug report's headline, for the picker. */
  title: string
}

const EXERCISE_NAME = /^[a-z0-9-]+$/

/** `title:` off a `meta.yaml`, or null when the field is absent. */
export function readExerciseTitle(yaml: string): string | null {
  for (const line of yaml.split('\n')) {
    // Top-level only: a nested `title:` under some other key is not this field,
    // and `domains:` entries are list items rather than keys.
    const match = /^title:\s*(.+?)\s*$/.exec(line)
    if (match) return match[1] ?? null
  }
  return null
}

/**
 * Every exercise under `debugging/`, in directory order.
 *
 * An exercise is a directory holding a `README.md` — the bug report. Anything
 * else in there is ignored rather than rejected: a stray file must not be able to
 * empty the picker.
 */
export function listExercises(root: string): Exercise[] {
  const base = join(root, 'debugging')
  if (!existsSync(base)) return []
  const found: Exercise[] = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!EXERCISE_NAME.test(entry.name)) continue
    if (!existsSync(join(base, entry.name, 'README.md'))) continue
    found.push({ name: entry.name, title: title(base, entry.name) })
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

function title(base: string, name: string): string {
  const metaPath = join(base, name, 'meta.yaml')
  if (!existsSync(metaPath)) return name
  try {
    return readExerciseTitle(readFileSync(metaPath, 'utf8')) ?? name
  } catch {
    // A `meta.yaml` that cannot be read costs a nice title, nothing more.
    return name
  }
}

/** The named exercise, or null. Resolved against disk, never trusted from a client. */
export function findExercise(root: string, name: string): Exercise | null {
  if (!EXERCISE_NAME.test(name)) return null
  return listExercises(root).find((exercise) => exercise.name === name) ?? null
}

/** `debugging/<exercise>` — the one place this path shape is written. */
export function exerciseDir(name: string): string {
  return `debugging/${name}`
}
