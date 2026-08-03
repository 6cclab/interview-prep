# Interview Prep Kit — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the interview-prep repo so that one canonical drill — the celebrity problem — is fully playable end to end, with a test harness that rejects brute-force solutions and a `.claude/` configuration that prevents spoilers.

**Architecture:** A standalone pnpm + TypeScript + Vitest repo. Committed content (problems, tests, worked solutions, commands) is generic and publishable; personal state (attempts, logs, company research) lives in a gitignored `local/` directory seeded from `templates/`. The distinguishing mechanism is a call-counting oracle in `test-utils/` that lets a test assert an operation *budget*, so a correct-but-O(n²) solution fails.

**Tech Stack:** TypeScript 5.7 (strict, ESM), Vitest 3, tsx for scripts, pnpm 10.28, Node 22.

## Global Constraints

- Package manager is **pnpm**. Never `npm` or `yarn` in scripts, docs, or commands.
- Repo root is `~/projects/interview-prep`. It is its own git repo; nothing in this plan writes to `~/job-search`.
- `local/` and `node_modules/` are gitignored. Everything else is committed.
- Author all commits as `Andre Pato <anpato@proton.me>`. **No AI co-author trailers.**
- ESM only: `"type": "module"`, `.ts` extensions omitted in relative imports resolved by Vitest's bundler resolution.
- Problem `README.md` files **must not name the pattern**. Naming it defeats the drill.
- Worked solutions live only in `solutions/`. No task may place a solution in `problems/`.

## Deliberate deviation from the spec

The spec's phase 1 lists **five** commands in `.claude/`. This plan ships **two** —
`/drill` and `/status`. `/design`, `/mock`, and `/prep` would be commands pointing at
`system-design/`, `behavioral/`, and company research that do not exist until phases
3–5, i.e. placeholders. They ship with the tracks they drive. `.claude/CLAUDE.md`
carries a track table naming each command and the phase it lands in, so the gap is
documented rather than silent.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | pnpm scripts: `test`, `setup`, `reset` |
| `tsconfig.json` | strict ESM TypeScript, no emit |
| `vitest.config.ts` | test discovery across `problems/`, `scripts/`, `test-utils/` |
| `test-utils/oracle.ts` | call-counting wrapper + budget assertion — the mechanism that fails brute force |
| `test-utils/oracle.test.ts` | tests for the harness itself |
| `scripts/reset.ts` | restore `stub.ts` over `solution.ts` for one problem |
| `scripts/reset.test.ts` | tests for reset, against a temp fixture tree |
| `scripts/setup.ts` | seed gitignored `local/` from `templates/local/` without overwriting |
| `templates/local/config.yaml` | optional `job_search_path` |
| `templates/local/drill-log.md` | empty drill log with its column contract |
| `problems/elimination/celebrity/` | the first drill: README, stub, solution, tests, meta |
| `solutions/elimination/celebrity.md` | worked answer — off-limits until asked for |
| `patterns.md` | pattern → tell → insight, the between-session review artifact |
| `.claude/CLAUDE.md` | durable session behavior: hint ladder, config resolution |
| `.claude/rules/no-spoilers.md` | hard gate |
| `.claude/settings.json` | pre-allow pnpm/vitest so drills aren't interrupted |
| `.claude/commands/drill.md` | the coding practice loop |
| `.claude/commands/status.md` | coverage and rust report |
| `README.md` | how to run a drill |

---

### Task 1: Repo scaffold and test runner

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Test: `test-utils/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: working `pnpm test` and `pnpm test <filter>` commands. All later tasks rely on `pnpm test <substring>` filtering test files by path substring.

- [ ] **Step 1: Write the failing smoke test**

Create `test-utils/smoke.test.ts`:

```ts
import { expect, it } from 'vitest'

it('runs the test suite', () => {
  expect(1 + 1).toBe(2)
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd ~/projects/interview-prep && pnpm test
```

Expected: FAIL — `ERR_PNPM_NO_SCRIPT  Missing script: test` (no `package.json` yet).

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "interview-prep",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.28.0",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "setup": "tsx scripts/setup.ts",
    "reset": "tsx scripts/reset.ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["problems", "scripts", "test-utils"]
}
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'problems/**/*.test.ts',
      'scripts/**/*.test.ts',
      'test-utils/**/*.test.ts',
    ],
    testTimeout: 10_000,
  },
})
```

- [ ] **Step 6: Install and run the test**

```bash
cd ~/projects/interview-prep && pnpm install && pnpm test
```

Expected: PASS — `1 passed`.

- [ ] **Step 7: Verify substring filtering works**

```bash
cd ~/projects/interview-prep && pnpm test smoke
```

Expected: PASS — `1 passed`, and the summary names `test-utils/smoke.test.ts`.

- [ ] **Step 8: Commit**

```bash
cd ~/projects/interview-prep
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts test-utils/smoke.test.ts
git commit -m "chore: scaffold pnpm + typescript + vitest"
```

---

### Task 2: Call-counting oracle — the mechanism that fails brute force

**Files:**
- Create: `test-utils/oracle.ts`
- Test: `test-utils/oracle.test.ts`
- Delete: `test-utils/smoke.test.ts` (superseded — this task's tests prove the runner works)

**Interfaces:**
- Consumes: `pnpm test` from Task 1
- Produces:
  - `countCalls<T extends (...args: never[]) => unknown>(fn: T): { fn: T; get calls(): number }`
  - `assertWithinBudget(calls: number, budget: number, label: string): void` — throws with a coaching message when over budget
  - Task 4's celebrity test imports both from `../../../test-utils/oracle`.

- [ ] **Step 1: Write the failing tests**

Create `test-utils/oracle.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertWithinBudget, countCalls } from './oracle'

describe('countCalls', () => {
  it('passes arguments through and returns the underlying result', () => {
    const counted = countCalls((a: number, b: number) => a + b)
    expect(counted.fn(2, 3)).toBe(5)
  })

  it('starts at zero calls', () => {
    const counted = countCalls(() => null)
    expect(counted.calls).toBe(0)
  })

  it('counts every invocation', () => {
    const counted = countCalls((x: number) => x)
    counted.fn(1)
    counted.fn(2)
    counted.fn(3)
    expect(counted.calls).toBe(3)
  })

  it('counts invocations that throw', () => {
    const counted = countCalls(() => {
      throw new Error('boom')
    })
    expect(() => counted.fn()).toThrow('boom')
    expect(counted.calls).toBe(1)
  })
})

describe('assertWithinBudget', () => {
  it('does nothing when under budget', () => {
    expect(() => assertWithinBudget(5, 10, 'knows()')).not.toThrow()
  })

  it('does nothing when exactly at budget', () => {
    expect(() => assertWithinBudget(10, 10, 'knows()')).not.toThrow()
  })

  it('throws when over budget', () => {
    expect(() => assertWithinBudget(11, 10, 'knows()')).toThrow()
  })

  it('reports the label, the count, and the budget', () => {
    expect(() => assertWithinBudget(250_000, 1500, 'knows()')).toThrow(
      /knows\(\).*250000.*1500/s,
    )
  })

  it('tells the reader a brute-force answer is not enough', () => {
    expect(() => assertWithinBudget(11, 10, 'knows()')).toThrow(/brute force/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/projects/interview-prep && pnpm test oracle
```

Expected: FAIL — `Failed to resolve import "./oracle"`.

- [ ] **Step 3: Write the implementation**

Create `test-utils/oracle.ts`:

```ts
/**
 * Test-harness utilities for drills whose difficulty is an operation budget
 * rather than an output value.
 *
 * A drill is only worth doing if a correct-but-brute-force answer fails it.
 * Where the problem hands the solver an expensive oracle, wrap it with
 * `countCalls` and assert a budget with `assertWithinBudget`.
 */

export interface CountingOracle<T> {
  /** Drop-in replacement for the wrapped function. */
  readonly fn: T
  /** How many times `fn` has been invoked. */
  readonly calls: number
}

export function countCalls<T extends (...args: never[]) => unknown>(
  fn: T,
): CountingOracle<T> {
  let calls = 0
  const wrapped = ((...args: Parameters<T>) => {
    calls += 1
    return fn(...(args as never[]))
  }) as T

  return {
    fn: wrapped,
    get calls() {
      return calls
    },
  }
}

export function assertWithinBudget(
  calls: number,
  budget: number,
  label: string,
): void {
  if (calls > budget) {
    throw new Error(
      `${label}: used ${calls} calls, budget is ${budget}. ` +
        `A correct answer is not enough here — brute force blows the budget. ` +
        `Find the observation that lets you discard work permanently.`,
    )
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/projects/interview-prep && pnpm test oracle
```

Expected: PASS — `9 passed`.

- [ ] **Step 5: Remove the superseded smoke test and typecheck**

```bash
cd ~/projects/interview-prep && rm test-utils/smoke.test.ts && pnpm typecheck && pnpm test
```

Expected: typecheck silent, tests `9 passed`.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/interview-prep
git add -A test-utils
git commit -m "feat: add call-counting oracle and budget assertion"
```

---

### Task 3: `pnpm reset` — restore a pristine stub

**Files:**
- Create: `scripts/reset.ts`
- Test: `scripts/reset.test.ts`
- Modify: `package.json` (already has the `reset` script from Task 1 — no change needed; verify only)

**Interfaces:**
- Consumes: `pnpm test` from Task 1
- Produces: `resetProblem(name: string, root?: string): string` — copies `<dir>/stub.ts` over `<dir>/solution.ts`, returns the resolved problem directory. Default `root` is `'problems'`. Task 8's README documents `pnpm reset <problem>`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/reset.test.ts`:

```ts
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetProblem } from './reset'

let root: string

function seedProblem(pattern: string, problem: string, stub: string, solution: string) {
  const dir = join(root, pattern, problem)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'stub.ts'), stub)
  writeFileSync(join(dir, 'solution.ts'), solution)
  return dir
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'reset-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resetProblem', () => {
  it('overwrites solution.ts with the contents of stub.ts', () => {
    const dir = seedProblem('elimination', 'celebrity', 'STUB', 'MY ANSWER')
    resetProblem('celebrity', root)
    expect(readFileSync(join(dir, 'solution.ts'), 'utf8')).toBe('STUB')
  })

  it('leaves stub.ts untouched', () => {
    const dir = seedProblem('elimination', 'celebrity', 'STUB', 'MY ANSWER')
    resetProblem('celebrity', root)
    expect(readFileSync(join(dir, 'stub.ts'), 'utf8')).toBe('STUB')
  })

  it('returns the resolved problem directory', () => {
    const dir = seedProblem('elimination', 'celebrity', 'STUB', 'MY ANSWER')
    expect(resetProblem('celebrity', root)).toBe(dir)
  })

  it('finds a problem regardless of which pattern directory holds it', () => {
    seedProblem('elimination', 'celebrity', 'STUB', 'MY ANSWER')
    const dir = seedProblem('intervals', 'merge-intervals', 'STUB2', 'ANSWER2')
    resetProblem('merge-intervals', root)
    expect(readFileSync(join(dir, 'solution.ts'), 'utf8')).toBe('STUB2')
  })

  it('throws a helpful error for an unknown problem', () => {
    seedProblem('elimination', 'celebrity', 'STUB', 'MY ANSWER')
    expect(() => resetProblem('does-not-exist', root)).toThrow(/no problem named "does-not-exist"/i)
  })

  it('throws when the same problem name exists under two patterns', () => {
    seedProblem('elimination', 'duplicate', 'A', 'A')
    seedProblem('intervals', 'duplicate', 'B', 'B')
    expect(() => resetProblem('duplicate', root)).toThrow(/ambiguous/i)
  })

  it('throws when the problem directory has no stub.ts', () => {
    const dir = join(root, 'elimination', 'no-stub')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'solution.ts'), 'MY ANSWER')
    expect(() => resetProblem('no-stub', root)).toThrow(/stub\.ts/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/projects/interview-prep && pnpm test reset
```

Expected: FAIL — `Failed to resolve import "./reset"`.

- [ ] **Step 3: Write the implementation**

Create `scripts/reset.ts`:

```ts
import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_ROOT = 'problems'

function problemDirs(root: string): string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  for (const pattern of readdirSync(root)) {
    const patternDir = join(root, pattern)
    if (!statSync(patternDir).isDirectory()) continue
    for (const problem of readdirSync(patternDir)) {
      const problemDir = join(patternDir, problem)
      if (statSync(problemDir).isDirectory()) found.push(problemDir)
    }
  }
  return found
}

/**
 * Restore a problem's pristine stub over the working solution file, so the
 * drill can be attempted again from scratch.
 *
 * @returns the resolved problem directory
 */
export function resetProblem(name: string, root: string = DEFAULT_ROOT): string {
  const matches = problemDirs(root).filter(
    (dir) => dir.split('/').at(-1) === name,
  )

  if (matches.length === 0) {
    throw new Error(`No problem named "${name}" under ${root}/`)
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous problem name "${name}" — matches ${matches.join(', ')}. ` +
        `Pass the pattern too, e.g. elimination/${name}.`,
    )
  }

  const dir = matches[0]!
  const stub = join(dir, 'stub.ts')
  if (!existsSync(stub)) {
    throw new Error(`Cannot reset ${dir}: no stub.ts to restore from.`)
  }

  copyFileSync(stub, join(dir, 'solution.ts'))
  return dir
}

const isCli = process.argv[1]?.endsWith('reset.ts')
if (isCli) {
  const name = process.argv[2]
  if (!name) {
    console.error('Usage: pnpm reset <problem>')
    process.exit(1)
  }
  try {
    console.log(`Reset ${resetProblem(name)}/solution.ts from stub.ts`)
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/projects/interview-prep && pnpm test reset
```

Expected: PASS — `7 passed`.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/interview-prep
git add scripts/reset.ts scripts/reset.test.ts
git commit -m "feat: add pnpm reset to restore a pristine problem stub"
```

---

### Task 4: The celebrity drill, end to end

**Files:**
- Create: `problems/elimination/celebrity/README.md`
- Create: `problems/elimination/celebrity/stub.ts`
- Create: `problems/elimination/celebrity/solution.ts`
- Create: `problems/elimination/celebrity/meta.yaml`
- Test: `problems/elimination/celebrity/solution.test.ts`

**Interfaces:**
- Consumes: `countCalls`, `assertWithinBudget` from `test-utils/oracle` (Task 2)
- Produces: `findCelebrity(n: number, knows: (a: number, b: number) => boolean): number` — the signature every later coding problem's stub/solution pair imitates. Task 5's worked solution documents this exact signature.

**Note for the implementer:** the deliverable is a drill Andre solves later. `solution.ts` must ship as a copy of `stub.ts` — an unimplemented throw. The test suite is expected to FAIL at the end of this task. That is the success condition, and Step 6 verifies it deliberately.

- [ ] **Step 1: Write the problem statement**

Create `problems/elimination/celebrity/README.md`. Do not name the pattern.

````markdown
# Find the Celebrity

There are `n` people at a party, labelled `0` through `n - 1`.

Exactly one of them may be a **celebrity**, defined by two properties:

1. The celebrity knows nobody at the party.
2. Everybody else at the party knows the celebrity.

You are given `n` and a helper `knows(a, b)` which returns `true` if and only if
person `a` knows person `b`.

Return the label of the celebrity, or `-1` if there isn't one.

## Constraints

- `1 <= n <= 5000`
- `knows(a, b)` is **expensive**. A solution that asks about every pair is too slow
  and this problem's test suite will reject it, even if it returns the right answer.
- Everybody knows themselves; `knows(a, a)` is always `true`.
- There is at most one celebrity.

## Examples

```
n = 2, knows = { 0 knows 1, 1 knows nobody but itself }
-> 1

n = 3, everybody knows only themselves
-> -1        (nobody is known by the others)

n = 1
-> 0         (vacuously: knows nobody else, and nobody else fails to know them)
```

## Signature

```ts
export function findCelebrity(
  n: number,
  knows: (a: number, b: number) => boolean,
): number
```

## Run it

```bash
pnpm test celebrity     # attempt
pnpm reset celebrity    # start over from a clean stub
```
````

- [ ] **Step 2: Write the stub**

Create `problems/elimination/celebrity/stub.ts`:

```ts
/**
 * @param n     number of people, labelled 0..n-1
 * @param knows knows(a, b) is true iff a knows b. Calling it is expensive.
 * @returns the celebrity's label, or -1 if there is none.
 */
export function findCelebrity(
  n: number,
  knows: (a: number, b: number) => boolean,
): number {
  throw new Error('not implemented')
}
```

- [ ] **Step 3: Seed the working file from the stub**

```bash
cd ~/projects/interview-prep
cp problems/elimination/celebrity/stub.ts problems/elimination/celebrity/solution.ts
```

- [ ] **Step 4: Write the metadata**

Create `problems/elimination/celebrity/meta.yaml`:

```yaml
pattern: elimination
title: Find the Celebrity
difficulty: medium
budget: 3n calls to knows()
companies:
  - name: toast
    confidence: high
    source: asked of Andre directly in a prior interview conversation
    date: "pre-2026-08"
```

- [ ] **Step 5: Write the test suite**

Create `problems/elimination/celebrity/solution.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertWithinBudget, countCalls } from '../../../test-utils/oracle'
import { findCelebrity } from './solution'

/**
 * Build a knows-matrix for a party of `n` where `celebrity` (or nobody, when
 * null) satisfies both celebrity properties. Non-celebrities know the
 * celebrity and a scattering of each other; everybody knows themselves.
 */
function party(n: number, celebrity: number | null): boolean[][] {
  const m = Array.from({ length: n }, () => Array<boolean>(n).fill(false))
  for (let a = 0; a < n; a++) m[a]![a] = true

  for (let a = 0; a < n; a++) {
    if (a === celebrity) continue
    if (celebrity !== null) m[a]![celebrity] = true
    const other = (a + 1) % n
    if (other !== celebrity && other !== a) m[a]![other] = true
  }
  return m
}

function oracleFor(m: boolean[][]) {
  return countCalls((a: number, b: number) => m[a]![b]!)
}

describe('findCelebrity — correctness', () => {
  it('finds the celebrity in a party of two', () => {
    const knows = oracleFor(party(2, 1))
    expect(findCelebrity(2, knows.fn)).toBe(1)
  })

  it('returns 0 for a party of one', () => {
    const knows = oracleFor(party(1, 0))
    expect(findCelebrity(1, knows.fn)).toBe(0)
  })

  it('finds a celebrity at the first index', () => {
    const knows = oracleFor(party(6, 0))
    expect(findCelebrity(6, knows.fn)).toBe(0)
  })

  it('finds a celebrity at the last index', () => {
    const knows = oracleFor(party(6, 5))
    expect(findCelebrity(6, knows.fn)).toBe(5)
  })

  it('finds a celebrity in the middle', () => {
    const knows = oracleFor(party(9, 4))
    expect(findCelebrity(9, knows.fn)).toBe(4)
  })

  it('returns -1 when nobody is known by everyone', () => {
    const knows = oracleFor(party(5, null))
    expect(findCelebrity(5, knows.fn)).toBe(-1)
  })

  it('returns -1 when the candidate knows somebody', () => {
    const m = party(4, 2)
    m[2]![3] = true // person 2 is known by all, but knows 3 — not a celebrity
    const knows = oracleFor(m)
    expect(findCelebrity(4, knows.fn)).toBe(-1)
  })

  it('returns -1 when one person fails to know the candidate', () => {
    const m = party(4, 2)
    m[3]![2] = false // person 3 does not know 2
    const knows = oracleFor(m)
    expect(findCelebrity(4, knows.fn)).toBe(-1)
  })
})

describe('findCelebrity — budget', () => {
  it('stays within 3n knows() calls on a large party', () => {
    const n = 500
    const knows = oracleFor(party(n, 317))
    expect(findCelebrity(n, knows.fn)).toBe(317)
    assertWithinBudget(knows.calls, 3 * n, 'knows()')
  })

  it('stays within 3n knows() calls when there is no celebrity', () => {
    const n = 500
    const knows = oracleFor(party(n, null))
    expect(findCelebrity(n, knows.fn)).toBe(-1)
    assertWithinBudget(knows.calls, 3 * n, 'knows()')
  })
})
```

- [ ] **Step 6: Verify the suite fails against the unimplemented stub**

```bash
cd ~/projects/interview-prep && pnpm test celebrity
```

Expected: FAIL — `10 failed`, every failure `Error: not implemented`. **This is the intended shipping state.**

- [ ] **Step 7: Verify the suite rejects a correct brute-force solution**

This is the check that proves the drill is worth doing. Temporarily paste this into `solution.ts`:

```ts
export function findCelebrity(
  n: number,
  knows: (a: number, b: number) => boolean,
): number {
  for (let candidate = 0; candidate < n; candidate++) {
    let ok = true
    for (let other = 0; other < n; other++) {
      if (other === candidate) continue
      if (knows(candidate, other) || !knows(other, candidate)) {
        ok = false
        break
      }
    }
    if (ok) return candidate
  }
  return -1
}
```

```bash
cd ~/projects/interview-prep && pnpm test celebrity
```

Expected: the 8 correctness tests PASS, and **both budget tests FAIL** with `knows(): used <N> calls, budget is 1500`.

If a budget test passes here, the suite is broken — the `party()` builder is producing a matrix that lets brute force get lucky. Fix the builder before continuing.

- [ ] **Step 8: Verify the suite accepts the reference solution**

Temporarily paste this into `solution.ts`:

```ts
export function findCelebrity(
  n: number,
  knows: (a: number, b: number) => boolean,
): number {
  let candidate = 0
  for (let other = 1; other < n; other++) {
    if (knows(candidate, other)) candidate = other
  }
  for (let other = 0; other < n; other++) {
    if (other === candidate) continue
    if (knows(candidate, other) || !knows(other, candidate)) return -1
  }
  return candidate
}
```

```bash
cd ~/projects/interview-prep && pnpm test celebrity
```

Expected: PASS — `10 passed`.

- [ ] **Step 9: Restore the stub so the drill ships unsolved**

```bash
cd ~/projects/interview-prep && pnpm reset celebrity && pnpm test celebrity
```

Expected: `Reset problems/elimination/celebrity/solution.ts from stub.ts`, then FAIL — `10 failed`, all `Error: not implemented`. This also serves as the end-to-end check on Task 3.

- [ ] **Step 10: Commit**

```bash
cd ~/projects/interview-prep
git add problems/elimination/celebrity
git commit -m "feat: add celebrity drill with a 3n knows() budget"
```

---

### Task 5: Worked solution and the pattern spine

**Files:**
- Create: `solutions/elimination/celebrity.md`
- Create: `patterns.md`

**Interfaces:**
- Consumes: the `findCelebrity` signature from Task 4
- Produces: the `solutions/<pattern>/<problem>.md` convention and the `patterns.md` table that Task 6's `/status` command reads to compute coverage.

**Note:** nothing in this task is executable. Verification is that `solutions/` contains no import of, and no path into, `problems/`.

- [ ] **Step 1: Write the worked solution**

Create `solutions/elimination/celebrity.md`:

````markdown
# Find the Celebrity — worked solution

> Spoiler. `.claude/rules/no-spoilers.md` forbids reading this into context
> unless Andre explicitly asks for it.

## The observation

Ask `knows(a, b)` once. Either answer eliminates somebody **permanently**:

- `true` — `a` knows somebody, so `a` is not the celebrity.
- `false` — somebody fails to know `b`, so `b` is not the celebrity.

One question, one candidate gone, forever. That is the whole problem. `n - 1`
questions leave exactly one survivor.

The survivor is only a *candidate*. Elimination proves everybody else is
disqualified; it does not prove this one qualifies. So verify.

## Solution

```ts
export function findCelebrity(
  n: number,
  knows: (a: number, b: number) => boolean,
): number {
  let candidate = 0
  for (let other = 1; other < n; other++) {
    if (knows(candidate, other)) candidate = other
  }

  for (let other = 0; other < n; other++) {
    if (other === candidate) continue
    if (knows(candidate, other) || !knows(other, candidate)) return -1
  }

  return candidate
}
```

## Complexity

- **Time:** O(n). Pass one is `n - 1` calls; pass two is at most `2(n - 1)`.
  Under `3n`, which is what the budget test asserts.
- **Space:** O(1).

## Why the first pass is safe

The obvious worry is that reassigning `candidate` discards somebody who was
actually the celebrity. It cannot. `candidate` is only replaced when
`knows(candidate, other)` is true, which disqualifies the outgoing candidate on
the spot. And anybody skipped over was disqualified when a later comparison
found somebody who didn't know them.

## Variants that share this pattern

- **Boyer–Moore majority vote** — a counter, and a differing element cancels a
  candidate. Same shape: one comparison discards work permanently, then a
  verification pass, because a "majority" candidate may not have a majority.
- **Tournament minimum/maximum** — pairwise comparison halves the field.
- **Two-pointer container-with-most-water** — moving the shorter wall is safe
  because every pairing with it is already dominated.

## The tell

You are handed an expensive comparison, and a single comparison result rules
somebody out for good. Reach for a candidate variable and one linear pass, then
**verify** — the elimination pass alone is never sufficient.

## Interview notes

- State the O(n²) approach in one sentence, then say you can do better, then
  find the invariant. Do not code the brute force.
- Say the verification pass out loud *before* writing it. Skipping it is the
  single most common failure on this problem, and interviewers watch for it.
- Handle `n = 1` explicitly when asked; the loops already return `0` for it.
````

- [ ] **Step 2: Write the pattern spine**

Create `patterns.md`. All twenty rows are present; problems arrive over later phases, so the Problem column carries a dash until then.

```markdown
# Patterns

Read this between sessions, not during them. Recall is keyed on the **tell** —
what about a problem statement should make you reach for a pattern — not on the
problem name.

| Pattern | The tell | The insight | Problem |
|---|---|---|---|
| elimination | An expensive comparison; one result disqualifies somebody for good | Linear pass to a candidate, then a separate verification pass | `celebrity` |
| two-pointers | Sorted input, or a pair/triple summing to a target | Moving the wrong end can only make things worse, so move the other | — |
| fast-slow-pointers | Linked structure, cycles, or "the middle" | Two speeds meet inside a cycle and split a list in one pass | — |
| sliding-window | Contiguous subarray or substring, with a constraint | Grow right, shrink left only while the constraint is violated | — |
| hashmap-counting | Anagrams, frequencies, "seen before" | Trade space for a lookup that removes an inner loop | — |
| prefix-sums | Repeated range sums or subarrays summing to k | Precompute cumulative totals; a range is one subtraction | — |
| in-place-array | "Without extra space", or removing/rotating elements | A write pointer trailing a read pointer | — |
| binary-search-answer | "Minimum capacity/speed such that…", monotone feasibility | Binary search the answer space, not the array | — |
| intervals | Meetings, merges, overlaps, calendars | Sort by start; then only the previous end matters | — |
| monotonic-stack | Next greater/smaller element, spans, histograms | Keep the stack sorted; popping resolves an earlier element's answer | — |
| heap-top-k | Top/bottom k, streaming median, merging sorted inputs | A size-k heap beats a full sort when k is small | — |
| binary-tree-recursion | Depth, path sums, validation, LCA | Define what the call returns for a subtree, then trust recursion | — |
| bfs-dfs-grid | Islands, regions, shortest path in a maze | BFS for fewest steps, DFS for reachability; mark visited on enqueue | — |
| graph-shortest-path | Weighted edges and a minimum cost | Dijkstra when weights are non-negative; plain BFS when they're uniform | — |
| topological-sort | Prerequisites, build order, dependency cycles | Kahn's algorithm; leftover nodes prove a cycle | — |
| union-find | Connectivity, accounts merging, redundant edges | Union by rank plus path compression, near-constant per operation | — |
| trie | Prefix search, autocomplete, word dictionaries | Share prefixes so lookup costs the length of the word, not the corpus | — |
| backtracking | Permutations, combinations, N-queens, sudoku | Choose, recurse, un-choose; prune as early as the constraint allows | — |
| dp-1d | "How many ways", min cost to reach the end, overlapping subproblems | Define the state, then the recurrence, then collapse the table to a row | — |
| string-stack-parsing | Nesting, brackets, decode/evaluate an expression | A stack is the only structure that matches nesting naturally | — |
```

- [ ] **Step 3: Verify no solution content leaked into `problems/`**

```bash
cd ~/projects/interview-prep && grep -rn "candidate" problems/ || echo "clean"
```

Expected: `clean`.

- [ ] **Step 4: Verify the drill still ships unsolved**

```bash
cd ~/projects/interview-prep && pnpm test
```

Expected: `oracle` and `reset` pass (16), celebrity fails (10).

- [ ] **Step 5: Commit**

```bash
cd ~/projects/interview-prep
git add solutions patterns.md
git commit -m "docs: add celebrity worked solution and the pattern spine"
```

---

### Task 6: `local/` bootstrap via `pnpm setup`

**Files:**
- Create: `templates/local/config.yaml`
- Create: `templates/local/drill-log.md`
- Create: `scripts/setup.ts`
- Test: `scripts/setup.test.ts`

**Interfaces:**
- Consumes: `pnpm test` from Task 1
- Produces: `seedLocal(templatesDir: string, destDir: string): string[]` — copies each template file that does not already exist at the destination, returns the list of created relative paths. Task 7's `.claude/CLAUDE.md` documents `local/config.yaml` and `local/drill-log.md` as the files `/drill` and `/status` read.

- [ ] **Step 1: Write the failing tests**

Create `scripts/setup.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedLocal } from './setup'

let base: string
let templates: string
let dest: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'setup-test-'))
  templates = join(base, 'templates')
  dest = join(base, 'local')
  mkdirSync(templates, { recursive: true })
  writeFileSync(join(templates, 'config.yaml'), 'job_search_path: ~/job-search\n')
  writeFileSync(join(templates, 'drill-log.md'), '# Drill Log\n')
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('seedLocal', () => {
  it('creates the destination directory', () => {
    seedLocal(templates, dest)
    expect(readFileSync(join(dest, 'config.yaml'), 'utf8')).toContain('job_search_path')
  })

  it('copies every template file', () => {
    expect(seedLocal(templates, dest).sort()).toEqual(['config.yaml', 'drill-log.md'])
  })

  it('never overwrites an existing file', () => {
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'drill-log.md'), 'MY REAL LOG')
    seedLocal(templates, dest)
    expect(readFileSync(join(dest, 'drill-log.md'), 'utf8')).toBe('MY REAL LOG')
  })

  it('reports only the files it actually created', () => {
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'drill-log.md'), 'MY REAL LOG')
    expect(seedLocal(templates, dest)).toEqual(['config.yaml'])
  })

  it('is idempotent', () => {
    seedLocal(templates, dest)
    expect(seedLocal(templates, dest)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/projects/interview-prep && pnpm test setup
```

Expected: FAIL — `Failed to resolve import "./setup"`.

- [ ] **Step 3: Write the implementation**

Create `scripts/setup.ts`:

```ts
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TEMPLATES = 'templates/local'
const DEST = 'local'

/**
 * Seed the gitignored `local/` directory from committed templates.
 * Existing files are never overwritten — this is safe to re-run.
 *
 * @returns the relative paths actually created
 */
export function seedLocal(templatesDir: string, destDir: string): string[] {
  mkdirSync(destDir, { recursive: true })

  const created: string[] = []
  for (const entry of readdirSync(templatesDir)) {
    const from = join(templatesDir, entry)
    if (!statSync(from).isFile()) continue
    const to = join(destDir, entry)
    if (existsSync(to)) continue
    copyFileSync(from, to)
    created.push(entry)
  }
  return created
}

const isCli = process.argv[1]?.endsWith('setup.ts')
if (isCli) {
  const created = seedLocal(TEMPLATES, DEST)
  if (created.length === 0) {
    console.log(`local/ is already set up — nothing to do.`)
  } else {
    console.log(`Created in local/: ${created.join(', ')}`)
    console.log(`Edit local/config.yaml if job-search lives somewhere unusual.`)
  }
}
```

- [ ] **Step 4: Write the template files**

Create `templates/local/config.yaml`:

```yaml
# Optional link back to the job-search repo.
#
# When set, /prep can read master-resume.md to write its gap note against your
# real record, and /mock can critique behavioral answers against
# communication-style.md. When unset or wrong, those steps are skipped with a
# note — nothing errors.
job_search_path: ~/job-search
```

Create `templates/local/drill-log.md`:

```markdown
# Drill Log

Appended by `/drill`. Hints used and elapsed time are the honest signal of
fluency — a solve that took four hints is a different fact from a cold solve,
and the log is useless if it flattens them.

`Hints` is the highest rung reached: 0 none, 1 nudge, 2 pattern named,
3 approach, 4 full solution shown.

| Date | Problem | Pattern | Solved | Hints | Time | Note |
|------|---------|---------|--------|-------|------|------|
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd ~/projects/interview-prep && pnpm test setup
```

Expected: PASS — `5 passed`.

- [ ] **Step 6: Run the real setup and confirm `local/` stays untracked**

```bash
cd ~/projects/interview-prep && pnpm setup && git status --short
```

Expected: `Created in local/: config.yaml, drill-log.md`, and `git status --short` shows **no** `local/` entry.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/interview-prep
git add scripts/setup.ts scripts/setup.test.ts templates
git commit -m "feat: seed gitignored local/ from committed templates"
```

---

### Task 7: `.claude/` — rules, settings, and the two commands

**Files:**
- Create: `.claude/CLAUDE.md`
- Create: `.claude/rules/no-spoilers.md`
- Create: `.claude/settings.json`
- Create: `.claude/commands/drill.md`
- Create: `.claude/commands/status.md`

**Interfaces:**
- Consumes: `pnpm test`/`pnpm reset` (Tasks 1, 3), `local/drill-log.md` column contract (Task 6), `patterns.md` table (Task 5)
- Produces: the durable session behavior every later phase extends. Phases 3–5 add `design.md`, `mock.md`, and `prep.md` to `.claude/commands/` and extend the track table in `CLAUDE.md`.

- [ ] **Step 1: Write the hard gate**

Create `.claude/rules/no-spoilers.md`:

```markdown
# No Spoilers

A drill is destroyed the moment the answer enters context. This is a hard gate,
not a preference.

- **Never volunteer** a solution, an approach, or a pattern name — including when
  you can see the attempt heading somewhere wrong. Watching Andre go down a bad
  path and saying nothing is the correct behavior.
- **Never read** `solutions/**` or `system-design/**/reference.md` into context
  unless Andre explicitly asks to see the answer. Do not open them "to check" an
  attempt. Judge the attempt against the tests or the rubric instead.
- **Never name the pattern** before rung 2, including indirectly. "Have you
  thought about a stack here?" is naming the pattern.
- **Advance exactly one rung per request.** Never two. If asked for "a hint",
  give the next rung and stop.

## The hint ladder

1. A nudge, phrased as a question, that does not name the pattern
2. The pattern name, and nothing else
3. The approach in words — no code
4. The full worked solution

"Show me" / "just tell me" jumps straight to rung 4. That is Andre's call to
make, and it is not a failure — log it and move on.

## Complexity before confirmation

When the tests go green, ask for his time and space complexity **before**
confirming he is done. Getting the right answer while misreading its cost is
the exact failure mode these drills exist to catch.
```

- [ ] **Step 2: Write the project instructions**

Create `.claude/CLAUDE.md`:

````markdown
# Interview Prep

Andre's interview practice repo. Standalone — it does not depend on the
job-search repo, but links to it when configured.

He has not interviewed in ~5 years. The rust is pattern recall under pressure,
not coding ability. Everything here is built around that: bounded problem sets,
budget-enforcing tests, and rationed hints.

## Tracks

| Track | Location | Command | Status |
|---|---|---|---|
| Coding | `problems/`, `solutions/` | `/drill` | live |
| System design | `system-design/` | `/design` | phase 3 |
| Behavioral | `behavioral/`, `local/stories.md` | `/mock` | phase 4 |
| Company prep | `local/companies/` | `/prep` | phase 5 |

## Layout

- `problems/<pattern>/<problem>/` — `README.md` (prompt, **never names the
  pattern**), `stub.ts` (pristine), `solution.ts` (his working file),
  `solution.test.ts`, `meta.yaml`
- `solutions/<pattern>/<problem>.md` — worked answers. **Spoilers.** See
  `rules/no-spoilers.md`.
- `patterns.md` — pattern → tell → insight. Between-session reading.
- `local/` — gitignored. His drill log, designs, story bank, company research.
- `templates/local/` — committed seeds for `local/`, copied by `pnpm setup`.

## Commands

```bash
pnpm setup              # seed local/ (idempotent, never overwrites)
pnpm test <problem>     # run one drill
pnpm test               # everything, as a regression check
pnpm reset <problem>    # restore stub.ts over solution.ts
pnpm typecheck
```

## Tests encode the insight

A drill is only worth doing if a **correct but brute-force** solution fails it.
Where a problem exposes an expensive oracle, wrap it with `countCalls` from
`test-utils/oracle.ts` and assert a budget with `assertWithinBudget`. Where no
oracle exists, use a large-N case under the 10s timeout.

When authoring a new problem, prove the suite three ways before committing: it
must fail a wrong solution, fail a brute-force solution, and pass the reference.
A suite a brute-force answer passes is broken, whatever the reference does.

## job-search link

`local/config.yaml` may set `job_search_path`. When present, commands may read
(never write):

- `user/master-resume.md` — the record `/prep` writes gap notes against
- `user/communication-style.md` — critique rubric for behavioral answers
- `user/research/<company>.md` — existing org research

When absent or wrong, skip the step with a one-line note. Never error, and never
guess the path.

## Tone

Andre's three standing rules, kept in job-search and applied here to any drafted
answer: first-person and conversational rather than third-person corporate;
never compliment a company by implying his current org is worse; answer the
question asked instead of pitching a project.
````

- [ ] **Step 3: Write the settings**

Create `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm test:*)",
      "Bash(pnpm reset:*)",
      "Bash(pnpm setup)",
      "Bash(pnpm typecheck)",
      "Bash(pnpm install)"
    ]
  }
}
```

- [ ] **Step 4: Write the `/drill` command**

Create `.claude/commands/drill.md`:

```markdown
---
name: drill
description: Run a coding drill — presents a problem cold, rations hints, logs the attempt
---

# /drill [pattern|problem]

Run one coding drill. `rules/no-spoilers.md` governs everything below and
overrides any instinct to be helpful.

## Selecting

- **A problem name** (`/drill celebrity`) — use it.
- **A pattern name** (`/drill intervals`) — pick a problem under that pattern,
  preferring never-attempted.
- **Nothing** — read `local/drill-log.md` and pick by rust: never-attempted
  first, then longest since a clean solve, then anything solved at hint rung 3+.
  Say which and why in one line.

## Running

1. Reset if the working file already holds a past answer and he wants a clean
   attempt: `pnpm reset <problem>`. Ask first — re-reading his own old solution
   is legitimate spaced review.
2. Print the problem's `README.md`. **Say nothing else.** No framing, no
   encouragement, no "this one's a classic."
3. Start a timer. Note the wall-clock start.
4. Wait. Do not comment on the attempt in progress.
5. On a hint request, advance exactly one rung. Never two.
6. When he says he's done, run `pnpm test <problem>`.

## On green

Ask for his time and space complexity **before** confirming. If he's wrong,
that's the finding — say so plainly and point at the line that costs more than
he thinks.

Then append one row to `local/drill-log.md`:

| Date | Problem | Pattern | Solved | Hints | Time | Note |

`Hints` is the highest rung reached (0–4). The note is one line on what actually
went wrong, not a grade. "Found the elimination pass, forgot to verify" is
useful. "Good job" is not.

## On red

Show the failing test names and nothing more. A budget failure is not a wrong
answer — say explicitly that the output was right and the cost was not, since
that distinction is the whole point of the drill.

## If he gives up

Log it as unsolved at rung 4 and offer to re-queue it in a few days. Do not
soften it. An honest log is the only thing that makes `/status` worth reading.
```

- [ ] **Step 5: Write the `/status` command**

Create `.claude/commands/status.md`:

```markdown
---
name: status
description: Coverage and rust across every prep track, ending with one next action
---

# /status

Report where prep actually stands. Be blunt; a flattering status report is
worthless.

## Read

- `patterns.md` — the full pattern list (the denominator)
- `problems/*/` — which patterns have a problem authored yet
- `local/drill-log.md` — attempts, hints, dates
- `local/designs/` and `local/stories.md` — if they exist yet
- `local/companies/` — companies prepped

## Report

**Coding.** Patterns with a problem authored, out of 20. Of those, how many
solved cold (rung 0–1), how many needed rung 3+, how many never attempted.
Name the three rustiest specifically — a pattern solved once six weeks ago at
rung 3 is rust, not coverage.

**System design.** Prompts attempted out of those authored, and the rubric
dimensions scoring weakest across attempts. Skip with one line if phase 3
hasn't landed.

**Behavioral.** Competencies with at least one story in `local/stories.md`, and
which have none. Skip with one line if phase 4 hasn't landed.

**Company prep.** Companies with a file in `local/companies/`, and any gap notes
still open.

## Close

Exactly one recommended next action, with the reason. Not a list. If the honest
answer is "drill the same pattern again," say that.
```

- [ ] **Step 6: Verify the rule file is discoverable and no spoiler paths are pre-allowed**

```bash
cd ~/projects/interview-prep && ls .claude .claude/rules .claude/commands && grep -c "solutions" .claude/settings.json || echo "no solutions path in settings — correct"
```

Expected: all five files listed; `no solutions path in settings — correct`.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/interview-prep
git add .claude
git commit -m "feat: add .claude config, no-spoilers gate, /drill and /status"
```

---

### Task 8: README and full-repo verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: every command and script from Tasks 1–7
- Produces: the phase-1 done state. Phase 2 begins from a repo where `pnpm test` passes everything except the intentionally-unsolved celebrity drill.

- [ ] **Step 1: Write the README**

Create `README.md`:

````markdown
# Interview Prep

Practice repo for coding drills, system design, and behavioral prep. Standalone —
job-search is optional.

## Setup

```bash
pnpm install
pnpm setup     # seeds gitignored local/
```

Then edit `local/config.yaml` if the job-search repo isn't at `~/job-search`, or
delete the line if it isn't on this machine.

## Drilling

```bash
pnpm test celebrity     # attempt the drill
pnpm reset celebrity    # start over from a clean stub
pnpm test               # everything, as a regression check
```

Or open Claude Code here and run `/drill` — it picks by what's rustiest,
presents the problem cold, and rations hints one rung at a time. `/status` says
where you stand.

## How this differs from grinding leetcode

**One problem per pattern, twenty total.** Recall is keyed on the pattern, so
problem `README`s deliberately never name it. `patterns.md` maps each pattern to
its *tell* — what in a problem statement should make you reach for it — and is
meant to be read between sessions, not during.

**Tests reject brute force.** Where a problem hands you an expensive oracle, the
suite counts calls and asserts a budget. Celebrity caps `knows()` at `3n`, so an
O(n²) solution returning the right person still fails. Green means you found the
insight, not that the output matched.

**Hints are rationed, not withheld.** Four rungs — nudge, pattern name, approach,
full solution — one per request. The log records which rung you reached, because
a solve at rung 3 and a cold solve are different facts.

## Layout

| Path | What |
|---|---|
| `problems/<pattern>/<problem>/` | prompt, stub, your working file, tests |
| `solutions/` | worked answers — spoilers, read deliberately |
| `patterns.md` | pattern → tell → insight |
| `system-design/` | prompts and rubrics (phase 3) |
| `behavioral/` | competency map and question bank (phase 4) |
| `local/` | gitignored: your log, designs, stories, company research |
````

- [ ] **Step 2: Verify the whole suite from a clean install**

```bash
cd ~/projects/interview-prep && rm -rf node_modules && pnpm install && pnpm typecheck && pnpm test
```

Expected: typecheck silent. Tests: `oracle` 9 pass, `reset` 7 pass, `setup` 5 pass, `celebrity` 10 fail with `Error: not implemented`. **Celebrity failing is correct** — it is an unsolved drill.

- [ ] **Step 3: Verify `local/` is not tracked and nothing leaked**

```bash
cd ~/projects/interview-prep && git status --short && git ls-files | grep -c "^local/" || echo "local/ correctly untracked"
```

Expected: clean working tree apart from `README.md`, and `local/ correctly untracked`.

- [ ] **Step 4: Verify the drill is genuinely playable**

```bash
cd ~/projects/interview-prep && cat problems/elimination/celebrity/README.md | grep -i -E "elimination|candidate|O\(n\)" || echo "no pattern leak in the prompt"
```

Expected: `no pattern leak in the prompt`.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/interview-prep
git add README.md
git commit -m "docs: add README covering setup, drilling, and repo layout"
```

---

## Phase 1 done when

- `pnpm install && pnpm setup && pnpm test celebrity` presents a real, unsolved drill
- The suite fails a brute-force solution, proven in Task 4 Step 7
- `pnpm reset celebrity` restores the stub
- `/drill` and `/status` exist and `rules/no-spoilers.md` gates them
- `local/` is untracked; nothing in `problems/` names a pattern or an approach

## Follow-on plans (not this document)

| Phase | Scope |
|---|---|
| 2 | The remaining 19 problems, one per pattern in `patterns.md`, each proven against wrong/brute-force/reference |
| 3 | System design: 6 prompts with rubrics and references, `/design` incl. `--live` |
| 4 | Behavioral: competency map, question bank, story bank seeded from `master-resume.md`, `/mock` |
| 5 | `/prep <company>`, run for Toast; add `interview_prep_path` to `job-search/user/config.yaml` |
