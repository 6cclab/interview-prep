# Interview Prep Kit — Phase 2 Implementation Plan

**Goal:** Author the remaining 19 coding drills, one per pattern in `patterns.md`, each with a test suite that rejects a correct-but-brute-force solution.

**Architecture:** Task 1 generalises the harness so no problem copy-pastes the randomisation machinery. Tasks 2–20 each author one problem in its own directory, following one fixed authoring contract. `patterns.md` is updated centrally by the controller, never by a problem author, to avoid write conflicts.

**Tech Stack:** TypeScript 5.7 strict ESM, Vitest 3, pnpm.

## Global Constraints

- pnpm only. Never npm, npx, or yarn.
- ESM; relative imports omit the `.ts` extension.
- Commits authored `Andre Pato <anpato@proton.me>`. NO `Co-Authored-By`, no AI/Claude attribution.
- `problems/**/README.md` must NEVER name the pattern or reveal the approach. Not in prose, not in a hint, not in the complexity target.
- Worked answers live ONLY in `solutions/<pattern>/<problem>.md`.
- Comments inside `problems/**` must not describe the intended algorithm — the solver reads those files mid-drill.
- Every problem ships UNSOLVED: `solution.ts` is a byte-identical copy of `stub.ts`, throwing `not implemented`. Its suite is expected to FAIL. That is the deliverable.
- No problem author touches `patterns.md`, `test-utils/`, `package.json`, or another problem's directory.

---

## The authoring contract

Every problem directory is `problems/<pattern>/<problem>/` containing:

| File | Content |
|---|---|
| `README.md` | Prompt, constraints, worked examples, the exact TypeScript signature, and the `pnpm test` / `pnpm reset` commands. Never names the pattern. States that a brute-force solution will be rejected. |
| `stub.ts` | The signature with a JSDoc for each parameter, body `throw new Error('not implemented')` |
| `solution.ts` | Byte-identical copy of `stub.ts` |
| `solution.test.ts` | Correctness tests + at least one rejection test |
| `meta.yaml` | `pattern`, `title`, `difficulty`, `budget` (a plain-English description of the rejection mechanism), `companies` (omit unless genuinely reported) |

Plus `solutions/<pattern>/<problem>.md`: the observation, the reference solution, complexity, why it is correct, sibling problems sharing the pattern, the tell, and interview notes.

### The two rejection mechanisms

A drill is only worth doing if a **correct but brute-force** solution fails it. Pick one:

**A. Oracle budget** — the problem hands the solver an expensive operation. Wrap it with `countCalls` from `test-utils/oracle`, assert with `assertWithinBudget`. Use `seededTrials` from `test-utils/random` so the fixture geometry is randomised and no fixed probe order can exploit it.

**B. Scale test** — no oracle exists, so use an input large enough that the brute force cannot finish inside Vitest's 10s timeout while the reference finishes in well under a second. Require at least two orders of magnitude of margin. Generate the input with `seededTrials`/`mulberry32` so it is deterministic.

### Authoring is not done until the suite is proven three ways

1. It FAILS a deliberately wrong solution.
2. It FAILS a **correct but brute-force** solution — the specific one named in the table below.
3. It PASSES the reference solution.

A suite that a brute-force answer passes is broken regardless of whether the reference passes. Record the measured numbers (call counts, or wall-clock for reference vs. brute force) in the report.

---

## Task 1: Generalise the randomisation harness

**Files:** Create `test-utils/random.ts`, `test-utils/random.test.ts`. Modify `problems/elimination/celebrity/solution.test.ts` to import from it. Modify `.claude/CLAUDE.md` to document both rejection mechanisms.

`mulberry32` and the seeded-trials loop currently live inside the celebrity test. Nineteen problems are about to need them; copy-paste would let the guarantee drift silently.

**Produces:**
- `mulberry32(seed: number): () => number`
- `seededTrials(seed: number, trials: number, body: (rng: () => number, trial: number) => void): void`
- `shuffled<T>(items: readonly T[], rng: () => number): T[]` — Fisher-Yates
- `randomPermutation(n: number, rng: () => number): number[]`

Celebrity's behaviour must not change: same seed, same 20 trials, same call counts, same 10 failures against the stub.

---

## Tasks 2–20: the nineteen problems

| # | Pattern | Problem | Mechanism | Brute force that must be rejected |
|---|---|---|---|---|
| 2 | two-pointers | `container-with-most-water` | B | all pairs, O(n²) |
| 3 | fast-slow-pointers | `cycle-start` | B | visited-set over a huge list, or O(n²) revisit scan |
| 4 | sliding-window | `longest-substring-no-repeat` | B | every substring, O(n²) |
| 5 | hashmap-counting | `group-anagrams` | B | pairwise comparison of every word, O(n²k) |
| 6 | prefix-sums | `subarray-sum-equals-k` | B | every subarray, O(n²) |
| 7 | in-place-array | `sort-colors` | A | array wrapped in an access-counting Proxy; budget ~2n reads+writes. Rejects a counting sort that makes multiple passes, and any comparison sort |
| 8 | binary-search-answer | `min-eating-speed` | B | linear scan over candidate speeds |
| 9 | intervals | `merge-intervals` | B | repeated O(n²) pairwise merging until stable |
| 10 | monotonic-stack | `daily-temperatures` | B | scan forward from each day, O(n²) |
| 11 | heap-top-k | `kth-largest-stream` | B | re-sort the whole history on every `add`, O(m·n log n) |
| 12 | binary-tree-recursion | `tree-diameter` | B | recompute height at every node, O(n²) on a degenerate tree |
| 13 | bfs-dfs-grid | `shortest-path-grid` | B | enumerate all paths (exponential) |
| 14 | graph-shortest-path | `network-delay` | B | Bellman-Ford O(V·E), or repeated relaxation |
| 15 | topological-sort | `course-order` | B | try permutations / repeated full scans, O(V·E) or worse |
| 16 | union-find | `redundant-connection` | B | re-run a DFS connectivity check per edge, O(E·V) |
| 17 | trie | `word-dictionary` | B | scan every inserted word on every query, O(queries·words·len) |
| 18 | backtracking | `n-queens-count` | B | enumerate all placements without pruning |
| 19 | dp-1d | `coin-change` | B | naive exponential recursion |
| 20 | string-stack-parsing | `decode-string` | B | repeated string rebuilding / regex passes until stable |

Difficulty, exact constraints, and example cases are the author's judgement, subject to the contract above.

---

## Controller-owned steps (not delegated)

- After each batch, add the problem name to the matching row of `patterns.md`.
- Verify the full suite: every problem's tests fail with `not implemented`; all non-problem tests pass.
- Final whole-branch review.

## Phase 2 done when

- 20 of 20 rows in `patterns.md` name a problem
- Every problem's suite is proven three ways and ships red
- `pnpm test` shows all harness/script tests passing and only `not implemented` failures
