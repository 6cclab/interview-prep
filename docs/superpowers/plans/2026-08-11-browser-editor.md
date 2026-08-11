# Browser Editor for the Coding Track — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coding drill be written in the browser, in a deliberately spartan editor, against the real `solution.ts` on the server.

**Architecture:** Two new slug-only routes read and write `problems/<pattern>/<slug>/solution.ts`, guarded by a content-hash version so a concurrent writer gets a 409 rather than silently losing work. A CodeMirror 6 document component provides highlighting and line numbers and nothing else. Editing mode is a property of the drill, chosen at start, recorded in the transcript header.

**Tech Stack:** TypeScript (ESM, `tsx`), node:http, React 19, vitest, CodeMirror 6.

## Global Constraints

- **The pattern is the answer, and a coding problem's path is its pattern.** Routes take a bare slug. `voice/problems.ts` stays the only module resolving a slug to a directory. No request or response body may contain the resolved path.
- **Do not modify `assertNoSpoilers`** in `voice/context.ts`, and do not widen `allowedPaths`.
- **Never read `solutions/**`, `patterns.md`, or `system-design/**/reference.md`.** They are answer keys; loading them defeats the tool. No task here needs them.
- **New dependencies are limited to exactly these four:** `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/lang-javascript`. Nothing else. In particular do NOT add a TypeScript language service, a linter integration, or an autocomplete package — their absence is the feature.
- **Client-supplied path segments are validated with `PROBLEM_SLUG`** (exported from `voice/context.ts`), never coerced.
- Commits authored by Andre Pato alone. Never add `Co-Authored-By` or any AI attribution trailer.
- **Gate for every task:** `pnpm typecheck` clean, and `pnpm test` with no regression against the baseline measured at branch start: **46 failed files / 360 failed tests / 1101 passed**. Those failures are deliberately-unsolved practice exercise stubs — never "fix" them.

---

### Task 1: Read and write `solution.ts` over HTTP

The server half, complete and testable before any UI exists.

**Files:**
- Create: `voice/solution-file.ts`
- Create: `voice/solution-file.test.ts`
- Modify: `voice/http-server.ts` (two new route handlers, beside the existing `/api/problems` handler at ~line 676)
- Modify: `voice/coding-routes.test.ts` (leak assertions)

**Interfaces:**
- Consumes: `findCodingProblem(root, slug): CodingProblem | null` and `problemDir(problem): string` from `voice/problems.ts`; `PROBLEM_SLUG` from `voice/context.ts`.
- Produces: `readSolution(root, slug): { text: string; version: string } | null`, `writeSolution(root, slug, text, expected): 'ok' | 'stale' | 'missing'`, `versionOf(text): string`.

- [ ] **Step 1: Write the failing test**

Create `voice/solution-file.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSolution, writeSolution, versionOf } from './solution-file'

/** A temp repo root holding one problem, so nothing here touches the real tree. */
function root(body = 'export function solve() {}\n'): string {
  const dir = mkdtempSync(join(tmpdir(), 'solution-file-'))
  const problem = join(dir, 'problems/two-pointers/valid-palindrome')
  mkdirSync(problem, { recursive: true })
  writeFileSync(join(problem, 'solution.ts'), body)
  writeFileSync(join(problem, 'meta.yaml'), 'pattern: two-pointers\ndifficulty: warmup\n')
  writeFileSync(join(problem, 'README.md'), '# Valid palindrome\n')
  writeFileSync(join(problem, 'solution.test.ts'), '')
  writeFileSync(join(problem, 'stub.ts'), body)
  return dir
}

describe('readSolution', () => {
  it('returns the file text and a version', () => {
    const got = readSolution(root(), 'valid-palindrome')
    expect(got?.text).toBe('export function solve() {}\n')
    expect(got?.version).toEqual(expect.any(String))
    expect(got?.version).not.toBe('')
  })

  it('returns null for a slug that resolves to no problem', () => {
    expect(readSolution(root(), 'no-such-problem')).toBeNull()
  })
})

describe('versionOf', () => {
  it('is stable for identical content and different for changed content', () => {
    expect(versionOf('a')).toBe(versionOf('a'))
    expect(versionOf('a')).not.toBe(versionOf('b'))
  })

  // Whitespace-only edits are real edits — a version that ignored them would
  // let one writer silently overwrite another's reformatting.
  it('distinguishes a trailing newline', () => {
    expect(versionOf('a')).not.toBe(versionOf('a\n'))
  })
})

describe('writeSolution', () => {
  it('writes when the expected version matches', () => {
    const dir = root()
    const before = readSolution(dir, 'valid-palindrome')!
    expect(writeSolution(dir, 'valid-palindrome', 'const x = 1\n', before.version)).toBe('ok')
    expect(readFileSync(join(dir, 'problems/two-pointers/valid-palindrome/solution.ts'), 'utf8'))
      .toBe('const x = 1\n')
  })

  // The whole point of the guard: a second writer must be told, not obeyed.
  it('refuses and leaves the file alone when the version is stale', () => {
    const dir = root()
    const stale = versionOf('something else entirely')
    expect(writeSolution(dir, 'valid-palindrome', 'const x = 1\n', stale)).toBe('stale')
    expect(readFileSync(join(dir, 'problems/two-pointers/valid-palindrome/solution.ts'), 'utf8'))
      .toBe('export function solve() {}\n')
  })

  it('reports a missing problem rather than creating one', () => {
    expect(writeSolution(root(), 'no-such-problem', 'x', versionOf('x'))).toBe('missing')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run voice/solution-file.test.ts`
Expected: FAIL — `Failed to resolve import "./solution-file"`.

- [ ] **Step 3: Implement `voice/solution-file.ts`**

```typescript
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findCodingProblem, problemDir } from './problems'

/**
 * Reading and writing a coding drill's working file.
 *
 * Writes the REAL `problems/<pattern>/<slug>/solution.ts` rather than a
 * session-scoped copy, and that is the load-bearing choice: `Run tests`
 * already runs vitest against that directory, `pnpm reset` already archives
 * that file to `local/attempts/`, and `/review` already debriefs from it. A
 * temp copy would have meant teaching all three about temp copies.
 *
 * Every function here takes a bare slug. A coding problem's path is its
 * pattern and the pattern is the answer, so `problems.ts` stays the only
 * module that turns one into the other, and no value returned from here
 * contains the resolved path.
 */

/**
 * A content hash, used to detect that someone else wrote the file since the
 * editor loaded it.
 *
 * Content rather than mtime: mtime has filesystem-dependent resolution, and two
 * writes inside one tick would compare equal — which is exactly the case the
 * guard exists for. Truncated to 16 hex characters; this detects accidental
 * concurrent edits, it is not a security boundary.
 */
export function versionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export interface SolutionFile {
  text: string
  version: string
}

/** The current contents, or null when the slug resolves to no problem. */
export function readSolution(root: string, slug: string): SolutionFile | null {
  const problem = findCodingProblem(root, slug)
  if (problem === null) return null
  const text = readFileSync(join(root, problemDir(problem), 'solution.ts'), 'utf8')
  return { text, version: versionOf(text) }
}

export type WriteOutcome = 'ok' | 'stale' | 'missing'

/**
 * Write only if the file still holds what the caller last saw.
 *
 * `'stale'` is not an error condition to be retried around — it means a second
 * tab or the candidate's own editor has the file, and the client must keep the
 * typed buffer and say so. Silently winning that race destroys work.
 */
export function writeSolution(
  root: string,
  slug: string,
  text: string,
  expected: string,
): WriteOutcome {
  const problem = findCodingProblem(root, slug)
  if (problem === null) return 'missing'
  const path = join(root, problemDir(problem), 'solution.ts')
  if (versionOf(readFileSync(path, 'utf8')) !== expected) return 'stale'
  writeFileSync(path, text)
  return 'ok'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run voice/solution-file.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the two routes**

In `voice/http-server.ts`, beside the existing `GET /api/problems` handler (~line 676), add:

```typescript
    // The coding track's working file. Slug-only in and out: a problem's path
    // is `problems/<pattern>/<slug>` and the pattern is the answer, so it never
    // crosses this boundary. See `stripPatternPaths` for the same rule applied
    // to anything derived from test output.
    const solutionRoute = /^\/api\/coding\/([^/]+)\/solution$/.exec(url.pathname)
    if (solutionRoute && (req.method === 'GET' || req.method === 'PUT')) {
      const slug = solutionRoute[1]!
      if (!PROBLEM_SLUG.test(slug)) {
        sendJson(res, 400, { error: 'Invalid problem name.' })
        return
      }

      if (req.method === 'GET') {
        const file = readSolution(root, slug)
        if (file === null) {
          sendJson(res, 404, { error: 'Unknown problem.' })
          return
        }
        sendJson(res, 200, file)
        return
      }

      let body: Record<string, unknown> | null
      try {
        body = await readJsonBody(req)
      } catch (error) {
        sendJson(res, 400, { error: errorMessage(error) })
        return
      }
      const text = body?.text
      const version = body?.version
      if (typeof text !== 'string' || typeof version !== 'string') {
        sendJson(res, 400, { error: 'A save needs `text` and `version`.' })
        return
      }

      const outcome = writeSolution(root, slug, text, version)
      if (outcome === 'missing') {
        sendJson(res, 404, { error: 'Unknown problem.' })
        return
      }
      if (outcome === 'stale') {
        // 409, the same shape `POST /end` uses for its non-re-entrancy latch.
        // The client keeps the typed buffer; it must never resolve this by
        // discarding what the candidate wrote.
        const current = readSolution(root, slug)!
        sendJson(res, 409, {
          error: 'solution.ts changed on disk since you opened it.',
          version: current.version,
        })
        return
      }
      sendJson(res, 200, { version: versionOf(text) })
      return
    }
```

Import `readSolution`, `writeSolution` and `versionOf` from `./solution-file`, and confirm `PROBLEM_SLUG` is already imported from `./context` (it is used elsewhere in this file).

- [ ] **Step 6: Add the leak assertions**

Append to `voice/coding-routes.test.ts`, following the pattern its existing pattern-leak tests use:

```typescript
describe('the solution routes', () => {
  it('never puts the resolved pattern path in a GET body', async () => {
    const res = await fetch(`${base}/api/coding/valid-palindrome/solution`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).not.toContain('problems/')
    expect(body).not.toContain('two-pointers')
  })

  it('rejects a slug that is not a plain slug', async () => {
    const res = await fetch(`${base}/api/coding/..%2F..%2Fsolutions/solution`)
    expect([400, 404]).toContain(res.status)
  })

  it('409s a save carrying a stale version, without changing the file', async () => {
    const before = await (await fetch(`${base}/api/coding/valid-palindrome/solution`)).json()
    const res = await fetch(`${base}/api/coding/valid-palindrome/solution`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'const x = 1\n', version: 'deadbeefdeadbeef' }),
    })
    expect(res.status).toBe(409)
    const after = await (await fetch(`${base}/api/coding/valid-palindrome/solution`)).json()
    expect(after.text).toBe(before.text)
  })
})
```

Use whatever server-fixture helper the surrounding tests already use for `base` and its temp root; do not stand up a second, differently-shaped fixture.

- [ ] **Step 7: Run the gates**

Run: `pnpm typecheck && pnpm vitest run voice/solution-file.test.ts voice/coding-routes.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add voice/solution-file.ts voice/solution-file.test.ts voice/http-server.ts voice/coding-routes.test.ts
git commit -m "feat(voice): read and write a drill's solution.ts over HTTP

Slug-only in and out, because a coding problem's path is its pattern. A
save carrying a stale content hash gets a 409 rather than winning the
race — a second tab or the candidate's own editor must not lose work."
```

---

### Task 2: The editor component

A React component wrapping CodeMirror 6, with nothing beyond highlighting and line numbers.

**Files:**
- Modify: `package.json` (four dependencies)
- Create: `voice/web/src/components/SolutionEditor.tsx`
- Create: `voice/web/src/components/SolutionEditor.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 (this task is presentation only).
- Produces: `<SolutionEditor value={string} onChange={(next: string) => void} readOnly?={boolean} />`.

- [ ] **Step 1: Add exactly four dependencies**

```bash
pnpm add @codemirror/state @codemirror/view @codemirror/commands @codemirror/lang-javascript
```

Add nothing else. No language service, no linter, no autocomplete package — see Global Constraints.

- [ ] **Step 2: Write the failing test**

Create `voice/web/src/components/SolutionEditor.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { editorExtensions } from './SolutionEditor'

/**
 * The extension list IS the design here — what is absent matters as much as
 * what is present — so it is asserted directly rather than through the DOM.
 * Asserting that CodeMirror renders would be testing CodeMirror.
 */
describe('editorExtensions', () => {
  it('builds a usable state with the configured extensions', () => {
    const state = EditorState.create({ doc: 'const x = 1\n', extensions: editorExtensions(false) })
    expect(state.doc.toString()).toBe('const x = 1\n')
  })

  it('is read-only when asked', () => {
    const state = EditorState.create({ doc: 'x', extensions: editorExtensions(true) })
    expect(state.readOnly).toBe(true)
  })

  it('is editable by default', () => {
    const state = EditorState.create({ doc: 'x', extensions: editorExtensions(false) })
    expect(state.readOnly).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run voice/web/src/components/SolutionEditor.test.tsx`
Expected: FAIL — `Failed to resolve import "./SolutionEditor"`.

- [ ] **Step 4: Implement `voice/web/src/components/SolutionEditor.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'

/**
 * A deliberately limited editor.
 *
 * Syntax highlighting, line numbers, bracket matching, undo. **No TypeScript
 * language service, no autocomplete, no inline diagnostics, no
 * go-to-definition** — their absence is the feature, not an unfinished job.
 * A real coding screen (CoderPad, HackerRank, CodeSignal) gives you a plain
 * document, so drilling with a full IDE rehearses an advantage you will not
 * have on the day.
 *
 * This is also why the editor is CodeMirror rather than Monaco: Monaco bundles
 * the language service, so getting this experience out of it means switching
 * off its main feature, and a later contributor would reasonably switch it
 * back on.
 *
 * Exported separately from the component so the extension list — which is the
 * actual design decision — can be asserted without a DOM.
 */
export function editorExtensions(readOnly: boolean): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    javascript({ typescript: true }),
    EditorState.readOnly.of(readOnly),
  ]
}

interface Props {
  value: string
  onChange(next: string): void
  readOnly?: boolean
}

export function SolutionEditor({ value, onChange, readOnly = false }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef(onChange)
  latest.current = onChange

  useEffect(() => {
    if (host.current === null) return
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...editorExtensions(readOnly),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = instance
    return () => {
      instance.destroy()
      view.current = null
    }
    // Mounted once. `value` is deliberately excluded: this is an uncontrolled
    // editor after mount, because reconstructing state on every keystroke would
    // throw away the cursor and the undo history. External replacements go
    // through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  // Adopt an externally-changed document (a reload after a 409), without
  // disturbing anything when the change came from typing.
  useEffect(() => {
    const instance = view.current
    if (instance === null) return
    const current = instance.state.doc.toString()
    if (current === value) return
    instance.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return <div ref={host} data-testid="solution-editor" />
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run voice/web/src/components/SolutionEditor.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Gates**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; no regression against 46 failed files / 360 failed tests / 1101 passed (this task adds 3 passes).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml voice/web/src/components/SolutionEditor.tsx voice/web/src/components/SolutionEditor.test.tsx
git commit -m "feat(web): a deliberately limited editor

Highlighting and line numbers, and nothing else. No language service, no
autocomplete, no diagnostics — their absence is the point. CodeMirror
rather than Monaco because Monaco bundles the thing being left out."
```

---

### Task 3: Wire the editor into the coding drill

Load, autosave, force-save before a test run, and handle 409 without losing the buffer.

**Files:**
- Create: `voice/web/src/useSolution.ts`
- Create: `voice/web/src/useSolution.test.ts`
- Modify: `voice/web/src/App.tsx` (render the editor on the coding route when the mode is `browser`)
- Modify: `voice/web/src/types.ts` (`Drill` gains `editor`)

**Interfaces:**
- Consumes: the routes from Task 1; `<SolutionEditor>` from Task 2.
- Produces: `useSolution(slug: string, enabled: boolean)` returning `{ text: string; setText(next: string): void; save(): Promise<'ok' | 'stale' | 'error'>; status: 'loading' | 'idle' | 'saving' | 'conflict' | 'error' }`.

- [ ] **Step 1: Write the failing test**

Create `voice/web/src/useSolution.test.ts`. Use the repo's existing pattern for testing a hook without a DOM renderer — if the surrounding client tests exercise plain functions rather than hooks, extract the save logic as a plain function `saveSolution(slug, text, version, fetchImpl)` and test that instead, keeping the hook a thin wrapper.

```typescript
import { describe, it, expect } from 'vitest'
import { saveSolution } from './useSolution'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('saveSolution', () => {
  it('returns the new version on success', async () => {
    const result = await saveSolution('valid-palindrome', 'x', 'v1', async () =>
      jsonResponse(200, { version: 'v2' }),
    )
    expect(result).toEqual({ kind: 'ok', version: 'v2' })
  })

  // The 409 must surface as its own outcome. Collapsing it into a generic
  // error would let the client retry, and a retry that "wins" is the data
  // loss the guard exists to prevent.
  it('reports a conflict distinctly, carrying the version now on disk', async () => {
    const result = await saveSolution('valid-palindrome', 'x', 'stale', async () =>
      jsonResponse(409, { error: 'changed on disk', version: 'v9' }),
    )
    expect(result).toEqual({ kind: 'stale', version: 'v9' })
  })

  it('reports a transport failure as an error rather than a conflict', async () => {
    const result = await saveSolution('valid-palindrome', 'x', 'v1', async () => {
      throw new Error('network down')
    })
    expect(result.kind).toBe('error')
  })

  it('sends the slug in the path and the version in the body', async () => {
    let seenUrl = ''
    let seenBody: unknown
    await saveSolution('valid-palindrome', 'const x = 1\n', 'v1', async (url, init) => {
      seenUrl = String(url)
      seenBody = JSON.parse(String(init?.body))
      return jsonResponse(200, { version: 'v2' })
    })
    expect(seenUrl).toBe('/api/coding/valid-palindrome/solution')
    expect(seenBody).toEqual({ text: 'const x = 1\n', version: 'v1' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run voice/web/src/useSolution.test.ts`
Expected: FAIL — `Failed to resolve import "./useSolution"`.

- [ ] **Step 3: Implement `voice/web/src/useSolution.ts`**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveResult =
  | { kind: 'ok'; version: string }
  /** The file changed underneath us. Keep the buffer; the user decides. */
  | { kind: 'stale'; version: string }
  | { kind: 'error' }

/**
 * One save round-trip.
 *
 * Split out of the hook so the outcome mapping — especially that a 409 is its
 * own kind and not an error — is testable without a renderer. A client that
 * retried a 409 would eventually win the race, which is precisely the data loss
 * the server-side guard exists to prevent.
 */
export async function saveSolution(
  slug: string,
  text: string,
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
  try {
    const res = await fetchImpl(`/api/coding/${slug}/solution`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, version }),
    })
    const body = (await res.json().catch(() => ({}))) as { version?: unknown }
    if (res.status === 200 && typeof body.version === 'string') {
      return { kind: 'ok', version: body.version }
    }
    if (res.status === 409 && typeof body.version === 'string') {
      return { kind: 'stale', version: body.version }
    }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export type SolutionStatus = 'loading' | 'idle' | 'saving' | 'conflict' | 'error'

const AUTOSAVE_IDLE_MS = 1000

export function useSolution(slug: string, enabled: boolean) {
  const [text, setTextState] = useState('')
  const [status, setStatus] = useState<SolutionStatus>('loading')
  const version = useRef('')
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/coding/${slug}/solution`)
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as { text: string; version: string }
        if (cancelled) return
        version.current = body.version
        setTextState(body.text)
        setStatus('idle')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug, enabled])

  const save = useCallback(async (): Promise<SaveResult['kind']> => {
    clearTimeout(timer.current)
    if (!dirty.current) return 'ok'
    setStatus('saving')
    const result = await saveSolution(slug, text, version.current)
    if (result.kind === 'ok') {
      version.current = result.version
      dirty.current = false
      setStatus('idle')
    } else if (result.kind === 'stale') {
      // Keep the buffer. The user is told the file moved and chooses.
      setStatus('conflict')
    } else {
      setStatus('error')
    }
    return result.kind
  }, [slug, text])

  const setText = useCallback((next: string) => {
    dirty.current = true
    setTextState(next)
  }, [])

  // Debounced autosave.
  useEffect(() => {
    if (!enabled || !dirty.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), AUTOSAVE_IDLE_MS)
    return () => clearTimeout(timer.current)
  }, [text, enabled, save])

  return { text, setText, save, status }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run voice/web/src/useSolution.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Force-save before a test run, as a testable function**

This ordering is the one correctness property of the save path, so it is a
plain function rather than logic buried in a callback. Add to
`voice/web/src/useSolution.ts`:

```typescript
/**
 * Save first, then run — and do not run at all if the save did not land.
 *
 * A verdict computed against stale text is a verdict for code the candidate
 * can see they did not write, and the verdict is the single signal a drill
 * produces. Running anyway would be worse than not running: it looks like an
 * answer.
 *
 * In `own` mode there is nothing to save; the candidate's editor already wrote
 * the file.
 */
export async function runAfterSave(
  mode: 'browser' | 'own' | undefined,
  save: () => Promise<SaveResult['kind']>,
  run: () => Promise<void>,
): Promise<'ran' | 'blocked'> {
  if (mode === 'browser') {
    const outcome = await save()
    if (outcome !== 'ok') return 'blocked'
  }
  await run()
  return 'ran'
}
```

Add its tests to `voice/web/src/useSolution.test.ts`:

```typescript
describe('runAfterSave', () => {
  it('saves before running, in that order', async () => {
    const order: string[] = []
    await runAfterSave(
      'browser',
      async () => { order.push('save'); return 'ok' },
      async () => { order.push('run') },
    )
    expect(order).toEqual(['save', 'run'])
  })

  it('does not run when the save conflicted', async () => {
    let ran = false
    const result = await runAfterSave('browser', async () => 'stale', async () => { ran = true })
    expect(result).toBe('blocked')
    expect(ran).toBe(false)
  })

  it('does not run when the save errored', async () => {
    let ran = false
    const result = await runAfterSave('browser', async () => 'error', async () => { ran = true })
    expect(result).toBe('blocked')
    expect(ran).toBe(false)
  })

  it('runs without saving in own-editor mode', async () => {
    let saved = false
    let ran = false
    await runAfterSave('own', async () => { saved = true; return 'ok' }, async () => { ran = true })
    expect(saved).toBe(false)
    expect(ran).toBe(true)
  })
})
```

Then in `voice/web/src/App.tsx`, the coding route's **Run tests** handler (which
reaches `CodingTools`'s `onRun`) calls `runAfterSave(drill.editor, solution.save, session.runTests)`,
using the file's actual identifiers for the existing run action.

- [ ] **Step 6: Extend the `Drill` type**

In `voice/web/src/types.ts`, add to the `Drill` interface:

```typescript
  /**
   * Coding track only: where the answer is written. `browser` puts a
   * deliberately limited editor on screen; `own` means the candidate edits
   * `solution.ts` in their own editor, which is the mode that keeps real types
   * and is better for learning a pattern cold. Absent means `own`.
   */
  editor?: 'browser' | 'own'
```

- [ ] **Step 7: Gates**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean, no regression.

- [ ] **Step 8: Commit**

```bash
git add voice/web/src/useSolution.ts voice/web/src/useSolution.test.ts voice/web/src/App.tsx voice/web/src/types.ts
git commit -m "feat(web): load, autosave and conflict-guard the solution buffer

Run tests force-saves first: a verdict computed against stale text is a
verdict for code the candidate can see they did not write. A 409 keeps the
buffer and says so rather than retrying, because a retry that wins is the
data loss the guard exists to prevent."
```

---

### Task 4: Choose the mode, and record it

**Files:**
- Modify: `voice/http-server.ts` (`parseDrill` at line 174 accepts `editor`)
- Modify: `voice/http-server.test.ts` (parse tests)
- Modify: `voice/web/src/components/Home.tsx` (the picker gains the choice)
- Modify: `voice/transcript.ts:141` (`formatSession` records the mode)
- Modify: `voice/transcript.test.ts`

**Interfaces:**
- Consumes: `Drill.editor` from Task 3.
- Produces: `formatSession(entries, startedAt, transport?, editor?)` — `editor` appended as a header line when present.

- [ ] **Step 1: Write the failing tests**

In `voice/http-server.test.ts`:

```typescript
it('accepts an editor mode on a coding drill', () => {
  expect(parseDrill({ track: 'coding', problem: 'valid-palindrome', editor: 'browser' }))
    .toMatchObject({ editor: 'browser' })
})

it('defaults to the candidate\'s own editor when unspecified', () => {
  expect(parseDrill({ track: 'coding', problem: 'valid-palindrome' }).editor).toBeUndefined()
})

it('rejects an unknown editor mode rather than coercing it', () => {
  expect(() => parseDrill({ track: 'coding', problem: 'valid-palindrome', editor: 'vim' }))
    .toThrow(/editor/i)
})
```

In `voice/transcript.test.ts`:

```typescript
it('records the editing mode in the header when there was one', () => {
  const out = formatSession([], new Date('2026-08-11T12:00:00Z'), 'cli / claude-sonnet-5', 'browser')
  expect(out).toContain('Editor: browser')
})

// A transcript read days later has to say how it was produced; a design drill
// has no editing mode and must not grow an empty line claiming it does.
it('omits the line entirely when no mode applies', () => {
  const out = formatSession([], new Date('2026-08-11T12:00:00Z'), 'cli / claude-sonnet-5')
  expect(out).not.toContain('Editor:')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run voice/http-server.test.ts voice/transcript.test.ts`
Expected: FAIL — `parseDrill` ignores `editor`; `formatSession` takes three parameters.

- [ ] **Step 3: Accept `editor` in `parseDrill`**

In `voice/http-server.ts`, after the existing `problem` validation and before the return, add:

```typescript
  const editor = body?.editor
  if (editor !== undefined && editor !== null && editor !== '') {
    if (track !== 'coding' || (editor !== 'browser' && editor !== 'own')) {
      throw new Error(`Invalid editor mode: ${String(editor)}`)
    }
  }
```

and include `editor` in the returned object when it is a valid string, matching how the function already returns `competency` only when present.

- [ ] **Step 4: Record the mode in the transcript**

In `voice/transcript.ts`, extend `formatSession`:

```typescript
export function formatSession(
  entries: Entry[],
  startedAt: Date,
  transport?: string,
  editor?: string,
): string {
```

and after the existing `Interviewer:` line:

```typescript
  // Recorded beside the transport for the same reason: a transcript read days
  // later has to say what produced it. The drill-log table is deliberately NOT
  // where this goes — its columns are parsed by `/status` and the `#/history`
  // screen, so adding one is a schema change with two readers to update.
  if (editor) lines.push(`Editor: ${editor}`, '')
```

Thread the session's `editor` value through from wherever `formatSession` is called for the coding track.

- [ ] **Step 5: Add the choice to the picker**

In `voice/web/src/components/Home.tsx`, on the coding problem picker, add a two-option control defaulting to `browser`, and include the value as `editor` in the `POST /api/session` body. Match the surrounding component's markup and class conventions; the content below is the requirement:

```tsx
{/*
  Both options are named with their trade-off rather than just their
  location, because the choice is not a preference — the modes test
  different things. See AGENTS.md, "Two editing modes".
*/}
<fieldset>
  <legend>Where are you writing this?</legend>
  <label>
    <input
      type="radio"
      name="editor"
      value="browser"
      checked={editor === 'browser'}
      onChange={() => setEditor('browser')}
    />
    Browser editor — an interview screen: highlighting and line numbers, no type checking
  </label>
  <label>
    <input
      type="radio"
      name="editor"
      value="own"
      checked={editor === 'own'}
      onChange={() => setEditor('own')}
    />
    My own editor — edit solution.ts yourself, with real types
  </label>
</fieldset>
```

with `const [editor, setEditor] = useState<'browser' | 'own'>('browser')` in the component, and `editor` added to the session-creation body alongside `track` and `problem`.

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm vitest run voice/http-server.test.ts voice/transcript.test.ts`
Expected: PASS.

- [ ] **Step 7: Gates**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean, no regression.

- [ ] **Step 8: Commit**

```bash
git add voice/http-server.ts voice/http-server.test.ts voice/transcript.ts voice/transcript.test.ts voice/web/src/components/Home.tsx
git commit -m "feat: choose the editing mode, and record it in the transcript

Not in the drill log: its columns are parsed by /status and #/history, so
a new one is a schema change with two readers. The transcript header
already answers 'what produced this artifact'."
```

---

### Task 5: Document the mode

**Files:**
- Modify: `AGENTS.md:186` (the "no editor in the browser" paragraph)
- Modify: `README.md`

- [ ] **Step 1: Rewrite the rationale rather than deleting it**

`AGENTS.md:186` currently opens *"There is no editor in the browser, deliberately."* That sentence is now false, but **the reasoning under it is still correct for one of the two modes** and must survive as the case for `own`.

Rewrite the paragraph to say there are two modes and when each is right:

- `browser` — an interview screen. Highlighting and line numbers, no type checking, no autocomplete. The absence is the feature: a real screen gives you no IDE, so drilling with one rehearses an advantage you will not have.
- `own` — you edit the real `solution.ts` in your own editor, against real types. Better for learning a pattern cold, which is what the original decision optimised for.

Keep every existing sentence about what does not change between modes: the three-way verdict, the hint ladder being a button with a server-side rung count, the drill-log row, and that a test run writes no candidate entry.

- [ ] **Step 2: Note the mode in the README's coding-track description**

One or two sentences: the drill asks which editor when it starts, and the browser one is deliberately limited.

- [ ] **Step 3: Gates**

Run: `pnpm typecheck && pnpm test && pnpm exercises`
Expected: all pass. `pnpm exercises` is included because it reads `AGENTS.md`-adjacent citations in exercise `meta.yaml` files.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs: two editing modes, and when each is right

The old rationale was not wrong, it was answering a different question.
It survives as the case for the your-own-editor mode."
```

---

## Verification

Before opening a PR:

- [ ] `pnpm typecheck && pnpm test && pnpm exercises` all pass
- [ ] `grep -rn "problems/" voice/web/src/` shows no client-side pattern path
- [ ] A real drill run end to end in browser mode: the file on disk matches what was typed, `Run tests` returns a verdict for the typed code, and the transcript header names the mode
- [ ] Open the same drill in two tabs, type in both: the second save gets a conflict notice and **no typed text is lost**
- [ ] `pnpm reset <problem>` archives a browser-written attempt to `local/attempts/`

## Known risks

- **The 409 path is the one that matters and the easiest to get wrong.** Every failure mode here ends in lost work. Task 3's tests cover the mapping; the two-tab check above is the real proof.
- **`editorExtensions` is a list that will attract additions.** Its doc comment states that the omissions are deliberate; a reviewer should treat any added completion/diagnostic extension as a defect rather than an improvement.
