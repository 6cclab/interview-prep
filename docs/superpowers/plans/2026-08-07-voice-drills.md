# Voice Drills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Andre run `/mock` behavioral and `/design --live` drills out loud — he speaks, the interviewer speaks back, and a verbatim transcript lands in `local/`.

**Architecture:** A local Node CLI that re-hosts the existing `.claude/commands/` prompts against the Messages API. The model is given **no tools**; the CLI reads an allowlisted set of files itself and injects them, which makes the spoiler files unreachable by construction. Speech in via local whisper.cpp, speech out via macOS `say`, both behind one-method interfaces so either can be swapped without touching the loop.

**Tech Stack:** TypeScript, tsx, vitest, `@anthropic-ai/sdk`, ffmpeg (avfoundation), whisper.cpp, macOS `say`.

**Spec:** `docs/superpowers/specs/2026-08-07-voice-drills-design.md`

## Global Constraints

- **Repo style:** no semicolons, single quotes, 2-space indent, named exports. Match `scripts/reset.ts`.
- **Testability by root-injection:** every function that touches the filesystem takes a `root` parameter so tests can point it at a tmpdir. Match `resetProblem(name, root)`.
- **Tests colocate** with source (`voice/context.ts` → `voice/context.test.ts`), same as `scripts/` and `test-utils/`.
- **Model:** `claude-opus-5`. Do **not** pass a `thinking` parameter — adaptive thinking is the default on this model. `output_config: {effort: 'medium'}`. Streaming.
- **`max_tokens: 16000`.** On this model `max_tokens` bounds thinking *plus* response text, so it cannot be sized to the visible answer alone.
- **Never read** `solutions/**`, `patterns.md`, or any `reference.md`. This is `.claude/rules/no-spoilers.md` and it is the one rule the code must enforce mechanically, not by convention.
- **`local/` is gitignored.** Never commit anything written there.
- **All new code lives under `voice/`.**

---

### Task 1: Context builder and the spoiler gate

The highest-value piece and the one with real test teeth. It owns every file read that reaches the model.

**Files:**
- Create: `voice/context.ts`
- Create: `voice/context.test.ts`
- Modify: `vitest.config.ts` (add `voice/**/*.test.ts` to `include`)
- Modify: `tsconfig.json` (add `voice` to `include`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Track = 'mock' | 'design'`
  - `assertNoSpoilers(paths: string[]): void` — throws if any path is denied
  - `allowedPaths(track: Track, problem?: string): string[]` — repo-relative
  - `competencyCoverage(root: string): { all: string[]; covered: string[] }`
  - `buildSystemPrompt(root: string, track: Track, problem?: string): string`

- [ ] **Step 1: Write the failing test**

Create `voice/context.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allowedPaths, assertNoSpoilers, buildSystemPrompt, competencyCoverage } from './context'

let root: string

function seed(relPath: string, body: string) {
  const full = join(root, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-context-'))
  seed('.claude/commands/mock.md', 'MOCK COMMAND')
  seed('.claude/commands/design.md', 'DESIGN COMMAND')
  seed('behavioral/competencies.md', '# C\n\n## Conflict\n\nbody\n\n## Ambiguity\n\nbody\n')
  seed('behavioral/questions.md', 'QUESTIONS')
  seed('system-design/rate-limiter/README.md', 'PROMPT')
  seed('system-design/rate-limiter/rubric.md', 'RUBRIC')
  seed('system-design/rate-limiter/reference.md', 'THE ANSWER')
  seed('solutions/elimination/celebrity.md', 'THE ANSWER')
  seed('patterns.md', 'THE ANSWER')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('assertNoSpoilers', () => {
  it.each([
    'solutions/elimination/celebrity.md',
    'patterns.md',
    'system-design/rate-limiter/reference.md',
  ])('rejects %s', (denied) => {
    expect(() => assertNoSpoilers([denied])).toThrow(/spoiler/i)
  })

  it('allows the files a drill legitimately needs', () => {
    expect(() =>
      assertNoSpoilers(['behavioral/competencies.md', 'system-design/rate-limiter/rubric.md']),
    ).not.toThrow()
  })
})

describe('allowedPaths', () => {
  it('never returns a denied path for mock', () => {
    expect(() => assertNoSpoilers(allowedPaths('mock'))).not.toThrow()
  })

  it('never returns a denied path for design', () => {
    expect(() => assertNoSpoilers(allowedPaths('design', 'rate-limiter'))).not.toThrow()
  })

  it('scopes design context to the requested problem', () => {
    expect(allowedPaths('design', 'rate-limiter')).toContain(
      'system-design/rate-limiter/rubric.md',
    )
  })
})

describe('competencyCoverage', () => {
  it('lists every competency heading', () => {
    expect(competencyCoverage(root).all).toEqual(['Conflict', 'Ambiguity'])
  })

  it('reports none covered when there is no story bank yet', () => {
    expect(competencyCoverage(root).covered).toEqual([])
  })

  it('reports covered competencies from the story bank headings', () => {
    seed('local/stories.md', '## Conflict\n\nThe Redis migration story, in full.\n')
    expect(competencyCoverage(root).covered).toEqual(['Conflict'])
  })
})

describe('buildSystemPrompt', () => {
  it('includes the command prompt and the competency map', () => {
    const prompt = buildSystemPrompt(root, 'mock')
    expect(prompt).toContain('MOCK COMMAND')
    expect(prompt).toContain('Conflict')
  })

  it('never includes a story body, only the competency name', () => {
    seed('local/stories.md', '## Conflict\n\nThe Redis migration story, in full.\n')
    const prompt = buildSystemPrompt(root, 'mock')
    expect(prompt).toContain('Conflict')
    expect(prompt).not.toContain('Redis migration')
  })

  it('includes the rubric for a design drill', () => {
    expect(buildSystemPrompt(root, 'design', 'rate-limiter')).toContain('RUBRIC')
  })

  it('never includes the reference design', () => {
    expect(buildSystemPrompt(root, 'design', 'rate-limiter')).not.toContain('THE ANSWER')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run voice/context.test.ts`
Expected: FAIL — `Failed to resolve import "./context"`

- [ ] **Step 3: Wire the new directory into the configs**

In `vitest.config.ts`, add one entry to the `include` array after `'test-utils/**/*.test.ts',`:

```ts
      'voice/**/*.test.ts',
```

In `tsconfig.json`, change the `include` line to:

```json
  "include": ["problems", "debugging", "feature", "scripts", "test-utils", "voice"]
```

- [ ] **Step 4: Write the implementation**

Create `voice/context.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Track = 'mock' | 'design'

/**
 * Paths the interviewer must never see. `.claude/rules/no-spoilers.md` states
 * these as instructions to a reader; here they are a runtime invariant, because
 * a drill is destroyed the moment the answer enters context.
 */
const DENIED = [/^solutions\//, /^patterns\.md$/, /(^|\/)reference\.md$/]

/**
 * Throw if any path is a spoiler. Called on every allowlist before it is read,
 * so widening the allowlist by mistake fails loudly instead of silently leaking.
 */
export function assertNoSpoilers(paths: string[]): void {
  for (const path of paths) {
    if (DENIED.some((pattern) => pattern.test(path))) {
      throw new Error(`Refusing to read spoiler file into an interview: ${path}`)
    }
  }
}

export function allowedPaths(track: Track, problem?: string): string[] {
  if (track === 'mock') {
    return [
      '.claude/commands/mock.md',
      'behavioral/competencies.md',
      'behavioral/questions.md',
    ]
  }
  if (!problem) throw new Error('A design drill needs a problem name.')
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

export function buildSystemPrompt(root: string, track: Track, problem?: string): string {
  const paths = allowedPaths(track, problem)
  assertNoSpoilers(paths)

  const sections = paths.map(
    (path) => `<file path="${path}">\n${readFileSync(join(root, path), 'utf8')}\n</file>`,
  )

  if (track === 'mock') {
    const { all, covered } = competencyCoverage(root)
    const lines = all.map((c) => `- ${c}${covered.includes(c) ? '' : ' (no story yet)'}`)
    sections.push(`<competency-coverage>\n${lines.join('\n')}\n</competency-coverage>`)
  }

  sections.push(
    [
      '<voice-mode>',
      'This interview is spoken aloud. Your text is read by a speech synthesiser',
      'and heard, not seen. Write plain prose only: no markdown, no bullet lists,',
      'no code blocks, no headings. Numbers and symbols must be spelled the way',
      'you would say them.',
      '',
      'You have no tools and no file access. Everything you are permitted to know',
      'is above. Do not ask for a file and do not claim to have read one.',
      '</voice-mode>',
    ].join('\n'),
  )

  return sections.join('\n\n')
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run voice/context.test.ts`
Expected: PASS, 14 tests

- [ ] **Step 6: Verify the gate has teeth**

Temporarily add `'patterns.md'` to the array returned by `allowedPaths` for `'mock'`, then run:

Run: `pnpm vitest run voice/context.test.ts`
Expected: FAIL — "never returns a denied path for mock" throws `Refusing to read spoiler file`.

**Revert that edit** before committing.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck
git add voice/context.ts voice/context.test.ts vitest.config.ts tsconfig.json
git commit -m "feat(voice): context builder with a mechanical spoiler gate"
```

---

### Task 2: Sentence chunker

Splits streamed deltas into speakable sentences so TTS can start before the model finishes.

**Files:**
- Create: `voice/chunk.ts`
- Create: `voice/chunk.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class SentenceBuffer` with `push(delta: string): string[]` and `flush(): string[]`

- [ ] **Step 1: Write the failing test**

Create `voice/chunk.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SentenceBuffer } from './chunk'

function feed(deltas: string[]): string[] {
  const buffer = new SentenceBuffer()
  const out = deltas.flatMap((delta) => buffer.push(delta))
  return [...out, ...buffer.flush()]
}

describe('SentenceBuffer', () => {
  it('emits a sentence as soon as it is terminated', () => {
    const buffer = new SentenceBuffer()
    expect(buffer.push('What are we optimising for?')).toEqual([
      'What are we optimising for?',
    ])
  })

  it('holds an unterminated fragment back', () => {
    const buffer = new SentenceBuffer()
    expect(buffer.push('What are we')).toEqual([])
  })

  it('reassembles a sentence split across deltas', () => {
    expect(feed(['What are ', 'we optimi', 'sing for?'])).toEqual([
      'What are we optimising for?',
    ])
  })

  it('splits multiple sentences in one delta', () => {
    expect(feed(['Start the clock. Say nothing else.'])).toEqual([
      'Start the clock.',
      'Say nothing else.',
    ])
  })

  it('flushes an unterminated tail', () => {
    expect(feed(['No trailing period'])).toEqual(['No trailing period'])
  })

  it('does not split inside a decimal', () => {
    expect(feed(['We serve 99.9 percent of reads.'])).toEqual([
      'We serve 99.9 percent of reads.',
    ])
  })

  it.each(['e.g.', 'i.e.', 'etc.', 'vs.'])('does not split after %s', (abbrev) => {
    expect(feed([`Pick a store, ${abbrev} Redis, and justify it.`])).toEqual([
      `Pick a store, ${abbrev} Redis, and justify it.`,
    ])
  })

  it('emits nothing for whitespace-only content', () => {
    expect(feed(['   ', '\n'])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run voice/chunk.test.ts`
Expected: FAIL — `Failed to resolve import "./chunk"`

- [ ] **Step 3: Write the implementation**

Create `voice/chunk.ts`:

```ts
const ABBREVIATIONS = ['e.g.', 'i.e.', 'etc.', 'vs.', 'approx.', 'Dr.', 'Mr.', 'Ms.']

function endsSentence(text: string, index: number): boolean {
  const char = text[index]
  if (char !== '.' && char !== '?' && char !== '!') return false

  if (char === '.') {
    const before = text[index - 1]
    const after = text[index + 1]
    // A decimal point: 99.9
    if (before && after && /\d/.test(before) && /\d/.test(after)) return false
    const head = text.slice(0, index + 1)
    if (ABBREVIATIONS.some((abbrev) => head.endsWith(abbrev))) return false
  }

  // A terminator only ends a sentence at end-of-buffer or before whitespace,
  // so "reads.The" mid-token is left alone until more deltas arrive.
  const next = text[index + 1]
  return next === undefined || /\s/.test(next)
}

/**
 * Accumulates streamed text deltas and emits complete sentences as soon as they
 * are terminated, so speech can begin before the model has finished generating.
 */
export class SentenceBuffer {
  private pending = ''

  push(delta: string): string[] {
    this.pending += delta
    const complete: string[] = []

    let start = 0
    for (let i = 0; i < this.pending.length; i++) {
      if (!endsSentence(this.pending, i)) continue
      const sentence = this.pending.slice(start, i + 1).trim()
      if (sentence) complete.push(sentence)
      start = i + 1
    }

    this.pending = this.pending.slice(start)
    return complete
  }

  flush(): string[] {
    const tail = this.pending.trim()
    this.pending = ''
    return tail ? [tail] : []
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run voice/chunk.test.ts`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add voice/chunk.ts voice/chunk.test.ts
git commit -m "feat(voice): sentence chunker for streaming speech output"
```

---

### Task 3: Transcript writer and story-log trailer

Writes the session file, and parses the structured trailer the interviewer emits so `local/stories.md` keeps the shape `/mock` gives it.

**Files:**
- Create: `voice/transcript.ts`
- Create: `voice/transcript.test.ts`

**Interfaces:**
- Consumes: `Track` from `voice/context.ts`.
- Produces:
  - `interface Entry { speaker: 'interviewer' | 'andre'; text: string; at: number }`
  - `interface StoryLog { competency: string; story: string; worked: string; fix: string }`
  - `splitTrailer(text: string): { spoken: string; log: StoryLog | null }`
  - `formatSession(entries: Entry[], startedAt: Date): string`
  - `sessionPath(track: Track, startedAt: Date, problem?: string): string` — repo-relative
  - `writeSession(root: string, relPath: string, body: string): void`
  - `appendStoryLog(root: string, log: StoryLog): void`

- [ ] **Step 1: Write the failing test**

Create `voice/transcript.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendStoryLog,
  formatSession,
  sessionPath,
  splitTrailer,
  writeSession,
} from './transcript'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-transcript-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const TRAILER = [
  'That result never landed. Cut the middle minute.',
  '',
  '```story-log',
  'competency: Conflict',
  'story: Redis migration',
  'worked: named the tradeoff out loud',
  'fix: no number in the result',
  '```',
].join('\n')

describe('splitTrailer', () => {
  it('strips the trailer from the spoken text', () => {
    expect(splitTrailer(TRAILER).spoken).toBe(
      'That result never landed. Cut the middle minute.',
    )
  })

  it('parses the trailer fields', () => {
    expect(splitTrailer(TRAILER).log).toEqual({
      competency: 'Conflict',
      story: 'Redis migration',
      worked: 'named the tradeoff out loud',
      fix: 'no number in the result',
    })
  })

  it('returns a null log when there is no trailer', () => {
    expect(splitTrailer('Just a question.')).toEqual({
      spoken: 'Just a question.',
      log: null,
    })
  })

  it('returns a null log when the trailer is missing a field', () => {
    const partial = '```story-log\ncompetency: Conflict\n```'
    expect(splitTrailer(partial).log).toBeNull()
  })
})

describe('formatSession', () => {
  it('labels each speaker and stamps elapsed time', () => {
    const startedAt = new Date('2026-08-07T10:00:00Z')
    const body = formatSession(
      [
        { speaker: 'interviewer', text: 'What are we optimising for?', at: 0 },
        { speaker: 'andre', text: 'Read latency.', at: 95_000 },
      ],
      startedAt,
    )
    expect(body).toContain('**Interviewer** [00:00]')
    expect(body).toContain('**Andre** [01:35]')
    expect(body).toContain('Read latency.')
  })
})

describe('sessionPath', () => {
  it('puts a design session where design.md says it goes', () => {
    expect(sessionPath('design', new Date('2026-08-07T10:00:00Z'), 'rate-limiter')).toBe(
      'local/designs/rate-limiter-live-2026-08-07.md',
    )
  })

  it('puts a mock session under local/', () => {
    expect(sessionPath('mock', new Date('2026-08-07T10:00:00Z'))).toBe(
      'local/mock-2026-08-07.md',
    )
  })
})

describe('writeSession', () => {
  it('creates missing parent directories', () => {
    writeSession(root, 'local/designs/rate-limiter-live-2026-08-07.md', 'BODY')
    expect(
      readFileSync(join(root, 'local/designs/rate-limiter-live-2026-08-07.md'), 'utf8'),
    ).toBe('BODY')
  })
})

describe('appendStoryLog', () => {
  const log = {
    competency: 'Conflict',
    story: 'Redis migration',
    worked: 'named the tradeoff',
    fix: 'no number in the result',
  }

  it('creates the story bank when it does not exist', () => {
    appendStoryLog(root, log)
    expect(readFileSync(join(root, 'local/stories.md'), 'utf8')).toContain('## Conflict')
  })

  it('appends without clobbering existing stories', () => {
    mkdirSync(join(root, 'local'), { recursive: true })
    writeFileSync(join(root, 'local/stories.md'), '## Ambiguity\n\nexisting\n')
    appendStoryLog(root, log)
    const body = readFileSync(join(root, 'local/stories.md'), 'utf8')
    expect(body).toContain('## Ambiguity')
    expect(body).toContain('## Conflict')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run voice/transcript.test.ts`
Expected: FAIL — `Failed to resolve import "./transcript"`

- [ ] **Step 3: Write the implementation**

Create `voice/transcript.ts`:

```ts
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Track } from './context'

export interface Entry {
  speaker: 'interviewer' | 'andre'
  text: string
  /** Milliseconds since the session started. */
  at: number
}

export interface StoryLog {
  competency: string
  story: string
  worked: string
  fix: string
}

const TRAILER = /```story-log\n([\s\S]*?)```/

/**
 * Separate the interviewer's spoken words from the structured trailer it emits
 * after a behavioral critique. The trailer feeds `local/stories.md`; it must
 * never reach the speech synthesiser.
 */
export function splitTrailer(text: string): { spoken: string; log: StoryLog | null } {
  const match = TRAILER.exec(text)
  if (!match) return { spoken: text.trim(), log: null }

  const fields = new Map<string, string>()
  for (const line of match[1]!.split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }

  const spoken = text.replace(TRAILER, '').trim()
  const competency = fields.get('competency')
  const story = fields.get('story')
  const worked = fields.get('worked')
  const fix = fields.get('fix')
  if (!competency || !story || !worked || !fix) return { spoken, log: null }

  return { spoken, log: { competency, story, worked, fix } }
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10)
}

export function formatSession(entries: Entry[], startedAt: Date): string {
  const lines = [`# Voice session — ${startedAt.toISOString()}`, '']
  for (const entry of entries) {
    const who = entry.speaker === 'interviewer' ? 'Interviewer' : 'Andre'
    lines.push(`**${who}** [${clock(entry.at)}]`, '', entry.text, '')
  }
  return lines.join('\n')
}

export function sessionPath(track: Track, startedAt: Date, problem?: string): string {
  if (track === 'design') {
    if (!problem) throw new Error('A design session needs a problem name.')
    return `local/designs/${problem}-live-${isoDate(startedAt)}.md`
  }
  return `local/mock-${isoDate(startedAt)}.md`
}

export function writeSession(root: string, relPath: string, body: string): void {
  const full = join(root, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, body)
}

export function appendStoryLog(root: string, log: StoryLog): void {
  const full = join(root, 'local/stories.md')
  mkdirSync(dirname(full), { recursive: true })
  const entry = [
    '',
    `## ${log.competency}`,
    '',
    `**Story.** ${log.story}`,
    '',
    `**What worked.** ${log.worked}`,
    '',
    `**Fix next time.** ${log.fix}`,
    '',
  ].join('\n')
  appendFileSync(full, entry)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run voice/transcript.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add voice/transcript.ts voice/transcript.test.ts
git commit -m "feat(voice): session transcript writer and story-log trailer"
```

---

### Task 4: Speech interfaces — whisper.cpp in, `say` out

Both are one-method interfaces with one implementation each. They are the parts most likely to be replaced.

**Files:**
- Create: `voice/speech.ts`
- Create: `voice/speech.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Utterance { text: string }`
  - `interface Transcriber { transcribe(wavPath: string): Promise<Utterance> }`
  - `interface Speaker { speak(text: string): Promise<void> }`
  - `parseWhisperOutput(stdout: string): Utterance`
  - `whisperTranscriber(opts: { binary: string; model: string }): Transcriber`
  - `saySpeaker(opts?: { voice?: string; rate?: number }): Speaker`

- [ ] **Step 1: Write the failing test**

Only the pure parsing is tested here. Asserting on whisper's accuracy or `say`'s
audio would be testing third-party software.

Create `voice/speech.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseWhisperOutput } from './speech'

describe('parseWhisperOutput', () => {
  it('joins timestamped segments into one utterance', () => {
    const stdout = [
      '[00:00:00.000 --> 00:00:03.240]   So the first thing I want to pin down',
      '[00:00:03.240 --> 00:00:06.100]   is the read to write ratio.',
    ].join('\n')
    expect(parseWhisperOutput(stdout).text).toBe(
      'So the first thing I want to pin down is the read to write ratio.',
    )
  })

  it('keeps filler and false starts verbatim', () => {
    const stdout = '[00:00:00.000 --> 00:00:02.000]   Um, so, I guess I would, uh, shard it.'
    expect(parseWhisperOutput(stdout).text).toBe('Um, so, I guess I would, uh, shard it.')
  })

  it('ignores non-segment log lines', () => {
    const stdout = [
      'whisper_init_from_file_with_params_no_state: loading model',
      '[00:00:00.000 --> 00:00:01.000]   Read latency.',
    ].join('\n')
    expect(parseWhisperOutput(stdout).text).toBe('Read latency.')
  })

  it('returns empty text for a silent recording', () => {
    expect(parseWhisperOutput('').text).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run voice/speech.test.ts`
Expected: FAIL — `Failed to resolve import "./speech"`

- [ ] **Step 3: Write the implementation**

Create `voice/speech.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface Utterance {
  text: string
}

export interface Transcriber {
  transcribe(wavPath: string): Promise<Utterance>
}

export interface Speaker {
  speak(text: string): Promise<void>
}

const SEGMENT = /^\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*(.*)$/

export function parseWhisperOutput(stdout: string): Utterance {
  const parts: string[] = []
  for (const line of stdout.split('\n')) {
    const match = SEGMENT.exec(line.trim())
    const segment = match?.[1]?.trim()
    if (segment) parts.push(segment)
  }
  return { text: parts.join(' ') }
}

/**
 * Local transcription via whisper.cpp. Local is the point: it keeps filler and
 * false starts that cloud dictation normalises away — and those are exactly what
 * `/mock` grades — and interview audio never leaves the machine.
 */
export function whisperTranscriber(opts: { binary: string; model: string }): Transcriber {
  return {
    async transcribe(wavPath: string): Promise<Utterance> {
      const { stdout } = await run(opts.binary, [
        '--model', opts.model,
        '--file', wavPath,
        '--language', 'en',
        '--no-prints',
      ])
      return parseWhisperOutput(stdout)
    },
  }
}

/** macOS `say`. Robotic but free and instant; swap this out, not the loop. */
export function saySpeaker(opts: { voice?: string; rate?: number } = {}): Speaker {
  return {
    async speak(text: string): Promise<void> {
      const args: string[] = []
      if (opts.voice) args.push('-v', opts.voice)
      if (opts.rate) args.push('-r', String(opts.rate))
      args.push(text)
      await run('say', args)
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run voice/speech.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Verify `say` works on this machine**

Run: `say -v Samantha "Start the clock."`
Expected: audible speech. If the voice is missing, pick one from `say -v '?'`.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add voice/speech.ts voice/speech.test.ts
git commit -m "feat(voice): whisper.cpp transcriber and macOS say speaker"
```

---

### Task 5: Microphone capture

Continuous recording. Nothing here decides when a turn ends — that is Enter, in Task 7.

**Files:**
- Create: `voice/audio.ts`
- Create: `voice/audio.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Recorder { stop(): Promise<string> }`
  - `ffmpegArgs(device: string, wavPath: string): string[]`
  - `record(dir: string, device?: string): Recorder`

- [ ] **Step 1: Write the failing test**

Create `voice/audio.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ffmpegArgs } from './audio'

describe('ffmpegArgs', () => {
  it('captures from the given avfoundation device', () => {
    const args = ffmpegArgs(':0', '/tmp/turn.wav')
    expect(args).toContain('avfoundation')
    expect(args).toContain(':0')
  })

  it('records 16 kHz mono, which is what whisper expects', () => {
    const args = ffmpegArgs(':0', '/tmp/turn.wav')
    expect(args).toContain('16000')
    expect(args.join(' ')).toMatch(/-ac 1/)
  })

  it('writes to the requested path', () => {
    expect(ffmpegArgs(':0', '/tmp/turn.wav').at(-1)).toBe('/tmp/turn.wav')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run voice/audio.test.ts`
Expected: FAIL — `Failed to resolve import "./audio"`

- [ ] **Step 3: Write the implementation**

Create `voice/audio.ts`:

```ts
import { spawn } from 'node:child_process'
import { join } from 'node:path'

export interface Recorder {
  /** Stop capture and resolve with the path to the finished wav. */
  stop(): Promise<string>
}

/** 16 kHz mono PCM — whisper's native input format, so no resampling step. */
export function ffmpegArgs(device: string, wavPath: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'avfoundation',
    '-i', device,
    '-ar', '16000',
    '-ac', '1',
    '-y',
    wavPath,
  ]
}

/**
 * Start capturing immediately and keep going until `stop()`. There is no
 * silence detection on purpose: in a design drill a long pause is the exercise,
 * not the end of a turn.
 */
export function record(dir: string, device = ':0'): Recorder {
  const wavPath = join(dir, `turn-${process.hrtime.bigint()}.wav`)
  const child = spawn('ffmpeg', ffmpegArgs(device, wavPath), { stdio: 'ignore' })

  return {
    stop(): Promise<string> {
      return new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', () => resolve(wavPath))
        // 'q' asks ffmpeg to finalise the container; SIGKILL would truncate it.
        child.kill('SIGINT')
      })
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run voice/audio.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Verify capture works end to end**

Run: `ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -A5 "audio devices"`
Expected: a numbered list. Note the index of the microphone — if it is not `0`, that index is the `device` argument (`:1`, `:2`, …).

Then record two seconds and play it back:

```bash
ffmpeg -hide_banner -loglevel error -f avfoundation -i :0 -ar 16000 -ac 1 -t 2 -y /tmp/mic-check.wav && afplay /tmp/mic-check.wav
```

Expected: you hear yourself. macOS will prompt for microphone permission the first time.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add voice/audio.ts voice/audio.test.ts
git commit -m "feat(voice): continuous microphone capture via ffmpeg"
```

---

### Task 6: Interviewer loop

The API call, behind an injectable stream function so the conversation logic is testable with no key and no network.

**Files:**
- Create: `voice/interviewer.ts`
- Create: `voice/interviewer.test.ts`
- Modify: `package.json` (add the `@anthropic-ai/sdk` dependency)

**Interfaces:**
- Consumes: `SentenceBuffer` from `voice/chunk.ts`. (It does *not* import `splitTrailer` — the loop suppresses the fenced block as it streams, and `splitTrailer` parses it afterwards in Task 7.)
- Produces:
  - `type StreamFn = (system: string, messages: Message[]) => AsyncIterable<string>`
  - `interface Message { role: 'user' | 'assistant'; content: string }`
  - `interface Interviewer { turn(said: string): AsyncIterable<string>; lastRaw(): string }`
  - `createInterviewer(system: string, stream: StreamFn): Interviewer`
  - `anthropicStream(client: Anthropic): StreamFn`

- [ ] **Step 1: Add the SDK dependency**

```bash
pnpm add @anthropic-ai/sdk
```

- [ ] **Step 2: Write the failing test**

Create `voice/interviewer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createInterviewer, type Message, type StreamFn } from './interviewer'

/** A stream that replays scripted deltas and records what it was sent. */
function scripted(turns: string[][]) {
  const seen: { system: string; messages: Message[] }[] = []
  let index = 0
  const stream: StreamFn = async function* (system, messages) {
    seen.push({ system, messages: structuredClone(messages) })
    for (const delta of turns[index] ?? []) yield delta
    index++
  }
  return { stream, seen }
}

async function collect(sentences: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = []
  for await (const sentence of sentences) out.push(sentence)
  return out
}

describe('createInterviewer', () => {
  it('yields sentences as they complete', async () => {
    const { stream } = scripted([['What are we ', 'optimising for? ', 'Be specific.']])
    const interviewer = createInterviewer('SYSTEM', stream)
    expect(await collect(interviewer.turn('Ready.'))).toEqual([
      'What are we optimising for?',
      'Be specific.',
    ])
  })

  it('passes the system prompt through unchanged', async () => {
    const { stream, seen } = scripted([['Go.']])
    await collect(createInterviewer('SYSTEM', stream).turn('Ready.'))
    expect(seen[0]!.system).toBe('SYSTEM')
  })

  it('accumulates history across turns', async () => {
    const { stream, seen } = scripted([['First question.'], ['Second question.']])
    const interviewer = createInterviewer('SYSTEM', stream)
    await collect(interviewer.turn('Ready.'))
    await collect(interviewer.turn('Read latency.'))
    expect(seen[1]!.messages).toEqual([
      { role: 'user', content: 'Ready.' },
      { role: 'assistant', content: 'First question.' },
      { role: 'user', content: 'Read latency.' },
    ])
  })

  it('never speaks the story-log trailer', async () => {
    const { stream } = scripted([
      ['Cut the middle minute. ', '```story-log\ncompetency: Conflict\n```'],
    ])
    const interviewer = createInterviewer('SYSTEM', stream)
    expect(await collect(interviewer.turn('Done.'))).toEqual(['Cut the middle minute.'])
  })

  it('keeps the trailer available on the raw turn', async () => {
    const { stream } = scripted([['Cut it. ', '```story-log\ncompetency: Conflict\n```']])
    const interviewer = createInterviewer('SYSTEM', stream)
    await collect(interviewer.turn('Done.'))
    expect(interviewer.lastRaw()).toContain('competency: Conflict')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run voice/interviewer.test.ts`
Expected: FAIL — `Failed to resolve import "./interviewer"`

- [ ] **Step 4: Write the implementation**

Create `voice/interviewer.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk'
import { SentenceBuffer } from './chunk'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

/** Yields text deltas. Injectable so the loop is testable without an API key. */
export type StreamFn = (system: string, messages: Message[]) => AsyncIterable<string>

export interface Interviewer {
  /** Feed what Andre said; yields the reply one speakable sentence at a time. */
  turn(said: string): AsyncIterable<string>
  /** The last reply in full, trailer included. */
  lastRaw(): string
}

/**
 * The trailer is a fenced block, and a fence opens with a backtick run that the
 * sentence chunker would happily speak. Hold output back once a fence starts.
 */
const FENCE = '```'

export function createInterviewer(system: string, stream: StreamFn): Interviewer {
  const messages: Message[] = []
  let raw = ''

  return {
    async *turn(said: string): AsyncIterable<string> {
      messages.push({ role: 'user', content: said })
      const buffer = new SentenceBuffer()
      raw = ''
      let fenced = false

      for await (const delta of stream(system, messages)) {
        raw += delta
        if (fenced) continue
        const fenceAt = delta.indexOf(FENCE)
        if (fenceAt !== -1) {
          fenced = true
          for (const sentence of buffer.push(delta.slice(0, fenceAt))) yield sentence
          continue
        }
        for (const sentence of buffer.push(delta)) yield sentence
      }

      for (const sentence of buffer.flush()) yield sentence
      messages.push({ role: 'assistant', content: raw })
    },

    lastRaw(): string {
      return raw
    },
  }
}

/**
 * The real stream. No `thinking` parameter: adaptive thinking is the default on
 * claude-opus-5, and `max_tokens` bounds thinking plus response text together.
 * Effort is `medium` because the interviewer's job is one good question and then
 * silence — lower effort means less preamble, which is exactly the brief.
 */
export function anthropicStream(client: Anthropic): StreamFn {
  return async function* (system, messages) {
    const stream = client.messages.stream({
      model: 'claude-opus-5',
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system,
      messages,
    })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run voice/interviewer.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 6: If `output_config` fails to typecheck**

`output_config.effort` is the current canonical parameter, but the installed
SDK's TypeScript types may lag it. If `pnpm typecheck` reports it as an unknown
property, keep the parameter and widen the call rather than dropping it — effort
is a deliberate choice here, not decoration:

```ts
    const stream = client.messages.stream({
      model: 'claude-opus-5',
      max_tokens: 16000,
      system,
      messages,
      // Types lag the API on this one; the parameter is correct.
      ...({ output_config: { effort: 'medium' } } as Record<string, unknown>),
    })
```

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck
git add voice/interviewer.ts voice/interviewer.test.ts package.json pnpm-lock.yaml
git commit -m "feat(voice): streaming interviewer loop with injectable transport"
```

---

### Task 7: CLI wiring and the full session

Ties it together and proves the loop with stubbed speech.

**Files:**
- Create: `voice/session.ts`
- Create: `voice/session.test.ts`
- Create: `voice/cli.ts`
- Modify: `package.json` (add `mock:voice` and `design:voice` scripts)
- Modify: `.claude/CLAUDE.md` (document the two commands)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces:
  - `interface SessionDeps { transcriber: Transcriber; speaker: Speaker; interviewer: Interviewer; startRecording(): Recorder; nextTurn(): Promise<'speak' | 'end'>; now(): number }`
  - `runSession(deps: SessionDeps): Promise<Entry[]>`

- [ ] **Step 1: Write the failing test**

Create `voice/session.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { runSession, type SessionDeps } from './session'
import type { Interviewer } from './interviewer'

function fakeInterviewer(replies: string[]): Interviewer {
  let index = 0
  return {
    async *turn() {
      for (const sentence of (replies[index] ?? '').split('|')) yield sentence
      index++
    },
    lastRaw: () => replies[index - 1] ?? '',
  }
}

function deps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  const turns: ('speak' | 'end')[] = ['speak', 'end']
  let tick = 0
  return {
    transcriber: { transcribe: async () => ({ text: 'Read latency.' }) },
    speaker: { speak: async () => {} },
    interviewer: fakeInterviewer(['What are we optimising for?', 'Good. Stop there.']),
    startRecording: () => ({ stop: async () => '/tmp/turn.wav' }),
    nextTurn: async () => turns.shift() ?? 'end',
    now: () => (tick += 1000),
    ...overrides,
  }
}

describe('runSession', () => {
  it('opens with the interviewer, not with Andre', async () => {
    const entries = await runSession(deps())
    expect(entries[0]!.speaker).toBe('interviewer')
  })

  it('records what Andre said, verbatim from the transcriber', async () => {
    const entries = await runSession(deps())
    expect(entries.map((e) => e.text)).toContain('Read latency.')
  })

  it('speaks every sentence the interviewer produces', async () => {
    const speak = vi.fn(async () => {})
    await runSession(deps({ speaker: { speak } }))
    expect(speak).toHaveBeenCalledWith('What are we optimising for?')
  })

  it('stops recording before transcribing', async () => {
    const order: string[] = []
    await runSession(
      deps({
        startRecording: () => ({
          stop: async () => {
            order.push('stop')
            return '/tmp/turn.wav'
          },
        }),
        transcriber: {
          transcribe: async () => {
            order.push('transcribe')
            return { text: 'Read latency.' }
          },
        },
      }),
    )
    // A final recorder is opened and stopped on the closing turn too, so this
    // asserts on the first cycle rather than the whole sequence.
    expect(order.slice(0, 2)).toEqual(['stop', 'transcribe'])
  })

  it('ends without a final user turn when Andre ends the session', async () => {
    const entries = await runSession(deps({ nextTurn: async () => 'end' }))
    expect(entries.every((e) => e.speaker === 'interviewer')).toBe(true)
  })

  it('stamps each entry with elapsed time', async () => {
    const entries = await runSession(deps())
    expect(entries.every((e) => typeof e.at === 'number')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run voice/session.test.ts`
Expected: FAIL — `Failed to resolve import "./session"`

- [ ] **Step 3: Write the session loop**

Create `voice/session.ts`:

```ts
import type { Recorder } from './audio'
import type { Interviewer } from './interviewer'
import type { Speaker, Transcriber } from './speech'
import type { Entry } from './transcript'

export interface SessionDeps {
  transcriber: Transcriber
  speaker: Speaker
  interviewer: Interviewer
  startRecording(): Recorder
  /** Resolves when Andre yields the turn, or 'end' to finish the session. */
  nextTurn(): Promise<'speak' | 'end'>
  /** Milliseconds since the session started. */
  now(): number
}

const OPENING = 'Begin the interview.'

/**
 * One drill, start to finish. The interviewer speaks first; after that every
 * cycle is: record until Andre yields, transcribe, reply, speak the reply.
 */
export async function runSession(deps: SessionDeps): Promise<Entry[]> {
  const entries: Entry[] = []
  let said = OPENING

  for (;;) {
    const at = deps.now()
    const spoken: string[] = []
    for await (const sentence of deps.interviewer.turn(said)) {
      spoken.push(sentence)
      await deps.speaker.speak(sentence)
    }
    entries.push({ speaker: 'interviewer', text: spoken.join(' '), at })

    const recorder = deps.startRecording()
    const decision = await deps.nextTurn()
    const wavPath = await recorder.stop()
    if (decision === 'end') return entries

    const heardAt = deps.now()
    const utterance = await deps.transcriber.transcribe(wavPath)
    entries.push({ speaker: 'andre', text: utterance.text, at: heardAt })
    said = utterance.text
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run voice/session.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Write the CLI**

Create `voice/cli.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { createInterface } from 'node:readline/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { record } from './audio'
import { buildSystemPrompt, type Track } from './context'
import { anthropicStream, createInterviewer } from './interviewer'
import { runSession } from './session'
import { saySpeaker, whisperTranscriber } from './speech'
import {
  appendStoryLog,
  formatSession,
  sessionPath,
  splitTrailer,
  writeSession,
} from './transcript'

const WHISPER_BINARY = process.env.WHISPER_BINARY ?? 'whisper-cli'
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? 'models/ggml-large-v3-turbo.bin'
const MIC_DEVICE = process.env.MIC_DEVICE ?? ':0'

async function main(): Promise<void> {
  const track = process.argv[2] as Track | undefined
  const problem = process.argv[3]

  if (track !== 'mock' && track !== 'design') {
    console.error('Usage: pnpm mock:voice | pnpm design:voice <problem>')
    process.exit(1)
  }
  if (track === 'design' && !problem) {
    console.error('Usage: pnpm design:voice <problem>')
    process.exit(1)
  }

  const root = process.cwd()
  const scratch = mkdtempSync(join(tmpdir(), 'voice-drill-'))
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const startedAt = new Date()
  const started = Date.now()

  const interviewer = createInterviewer(
    buildSystemPrompt(root, track, problem),
    anthropicStream(new Anthropic()),
  )

  console.log('Recording. Press Enter to hand the turn back. Type "end" to finish.\n')

  try {
    const entries = await runSession({
      transcriber: whisperTranscriber({ binary: WHISPER_BINARY, model: WHISPER_MODEL }),
      speaker: saySpeaker({ voice: process.env.SAY_VOICE }),
      interviewer,
      startRecording: () => record(scratch, MIC_DEVICE),
      nextTurn: async () => ((await rl.question('')).trim() === 'end' ? 'end' : 'speak'),
      now: () => Date.now() - started,
    })

    const relPath = sessionPath(track, startedAt, problem)
    writeSession(root, relPath, formatSession(entries, startedAt))
    console.log(`\nTranscript: ${relPath}`)

    const { log } = splitTrailer(interviewer.lastRaw())
    if (track === 'mock' && log) {
      appendStoryLog(root, log)
      console.log('Story bank: local/stories.md')
    }
  } finally {
    rl.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exit(1)
})
```

- [ ] **Step 6: Add the package scripts**

In `package.json`, add these two entries to `scripts`, after `"reset"`:

```json
    "mock:voice": "tsx voice/cli.ts mock",
    "design:voice": "tsx voice/cli.ts design",
```

- [ ] **Step 7: Run the voice suites and typecheck**

**Do not expect `pnpm test` to pass.** In this repo unsolved drills ship red on
purpose — `problems/**/solution.ts` throws `not implemented` until Andre solves
it. At the time this plan was written the baseline was **28 failed test files**,
all of them drill stubs. A green full suite would mean the drills had been
damaged.

Run: `pnpm vitest run voice/ && pnpm typecheck`
Expected: every `voice/` suite passes, typecheck clean.

Then confirm nothing outside `voice/` regressed:

Run: `pnpm vitest run 2>&1 | tail -5`
Expected: the failed-file count is still 28, and no failing path starts with
`voice/`. A count above 28, or any `voice/` failure, is a regression to fix.

- [ ] **Step 8: Run one real drill end to end**

Prerequisites, if not already present:

```bash
brew install ffmpeg whisper-cpp
# Download the model to whatever path WHISPER_MODEL points at.
```

Then:

```bash
pnpm design:voice rate-limiter
```

Expected: the interviewer speaks the prompt aloud, waits, and a transcript appears at `local/designs/rate-limiter-live-<date>.md`. Confirm the transcript keeps filler words — if it reads suspiciously clean, transcription is being normalised somewhere and that defeats the point.

- [ ] **Step 9: Document the commands**

In `.claude/CLAUDE.md`, add these two lines to the Commands code block, after the `pnpm reset` line:

```
pnpm mock:voice         # spoken behavioral drill
pnpm design:voice <p>   # spoken live design drill
```

- [ ] **Step 10: Commit**

```bash
git add voice/session.ts voice/session.test.ts voice/cli.ts package.json .claude/CLAUDE.md
git commit -m "feat(voice): session loop and CLI for spoken mock and design drills"
```

---

## Notes for the implementer

**Do not add file tools to the interviewer.** The absence of tools is the spoiler guarantee, not an oversight. If a track later needs another file, add it to `allowedPaths` in `voice/context.ts` — `assertNoSpoilers` will reject it if it is a spoiler, which is the intended outcome.

**Do not add silence detection.** It reads like an obvious improvement and it is the wrong call: `design.md` makes thinking silence part of the exercise, and a VAD threshold short enough to feel responsive will cut Andre off mid-thought.

**`local/` is gitignored.** Nothing written by a drill should ever appear in `git status` as a candidate for commit.
