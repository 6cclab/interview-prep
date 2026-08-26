import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer, type VoiceServerDeps } from './http-server'
import { resetProblemSource } from './problems'
import { createSessionStore } from './session-store'
import { allowedPaths, assertNoSpoilers } from './context'
import { buildPracticeChatPrompt, codeCue, practiceChatPaths } from './practice-chat'
import { useCliBackend } from './test-helpers/backend-env'

useCliBackend()

/**
 * The practice tutor.
 *
 * Practice is a learning mode, not a drill: no interviewer, no session, no
 * record. So most of what is worth testing here is not behaviour but the
 * boundary — what the tutor is allowed to read, and what it can therefore say.
 *
 * The rule under test throughout is the one `practice-chat.ts` states: **the
 * tutor knows nothing the learner cannot already read.** The learner can open
 * devtools and read the suite the browser was served; they cannot read
 * `solutions/`, `patterns.md`, or the fixture comments that were stripped out
 * of their copy.
 */

let server: Server | undefined
let root: string

const PATTERN = 'sliding-window'
const SLUG = 'max-sum-window'

/** A phrase that exists only in the worked answer, so finding it anywhere is proof of a leak. */
const WORKED_ANSWER = 'WORKED-ANSWER-SPOILER expand right, shrink left'
/** A phrase that exists only in a suite *comment*, i.e. in the copy the browser never gets. */
const FIXTURE_COMMENT_SPOILER = 'FIXTURE-COMMENT-SPOILER lives in problems/sliding-window'

function seed(relPath: string, body: string): void {
  const full = join(root, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body)
}

function seedProblem(): void {
  seed('prompts/practice-chat.md', 'TUTOR COMMAND')
  seed(`problems/${PATTERN}/${SLUG}/README.md`, '# Max sum window\n\nFind the best window.\n')
  seed(`problems/${PATTERN}/${SLUG}/stub.ts`, 'export function maxSumWindow() {}\n')
  seed(
    `problems/${PATTERN}/${SLUG}/solution.test.ts`,
    `// ${FIXTURE_COMMENT_SPOILER}\ndescribe('max sum window — correctness', () => {\n  it('finds the window', () => {})\n})\n`,
  )
  seed(`problems/${PATTERN}/${SLUG}/meta.yaml`, `pattern: ${PATTERN}\ndifficulty: medium\n`)
  // Seeded on purpose: a root with no spoiler in it cannot demonstrate that the
  // spoiler stays unread.
  seed(`solutions/${PATTERN}/${SLUG}.md`, WORKED_ANSWER)
  seed('patterns.md', `PATTERNS-SPOILER ${PATTERN} -> grow and shrink`)
}

function baseDeps(overrides: Partial<VoiceServerDeps> = {}): VoiceServerDeps {
  const now = overrides.now ?? ((): number => 0)
  return {
    root,
    createTransport: () =>
      async function* () {
        yield 'A sliding window keeps a running total.'
      },
    transcriber: { transcribe: async () => ({ text: '' }) },
    store: createSessionStore(() => 'session-1', now),
    now,
    ...overrides,
  }
}

function listen(deps: VoiceServerDeps): Promise<{ port: number }> {
  server = createVoiceServer(deps)
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo')
      resolve({ port: address.port })
    })
  })
}

function ask(port: number, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/practice/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ONE_QUESTION = [{ role: 'user', content: 'What is a sliding window?' }]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-practice-'))
  seedProblem()
})

afterEach(async () => {
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server!.close(() => resolve()))
  }
  server = undefined
  resetProblemSource()
  rmSync(root, { recursive: true, force: true })
})

describe('practiceChatPaths', () => {
  const paths = (): string[] => practiceChatPaths({ slug: SLUG, pattern: PATTERN })

  // The suite is the entry that distinguishes this door from a drill's. It is
  // in because the browser already has it — see the module comment.
  it('reads the README, the stub and the suite', () => {
    expect(paths()).toContain(`problems/${PATTERN}/${SLUG}/README.md`)
    expect(paths()).toContain(`problems/${PATTERN}/${SLUG}/stub.ts`)
    expect(paths()).toContain(`problems/${PATTERN}/${SLUG}/solution.test.ts`)
  })

  it('never reads the worked answer, the pattern notes or meta.yaml', () => {
    for (const path of paths()) {
      expect(path).not.toMatch(/^solutions\//)
      expect(path).not.toMatch(/patterns\.md$/)
      expect(path).not.toMatch(/meta\.yaml$/)
      expect(path).not.toMatch(/solution\.ts$/)
    }
  })

  /**
   * The difference from `coachPaths`, and the reason this door can keep the
   * guard the coach has to bypass. If a later edit adds `solutions/...` here,
   * this fails rather than the tutor quietly teaching from the answer key.
   */
  it('survives assertNoSpoilers, which coachPaths deliberately cannot', () => {
    expect(() => assertNoSpoilers(paths())).not.toThrow()
  })

  it('rejects a slug or pattern that is not a bare slug', () => {
    expect(() => practiceChatPaths({ slug: '../etc', pattern: PATTERN })).toThrow(/Invalid problem/)
    expect(() => practiceChatPaths({ slug: SLUG, pattern: '../etc' })).toThrow(/Invalid pattern/)
  })
})

describe('allowedPaths', () => {
  // A third door, refused by the first one explicitly rather than by falling
  // through to some track's list — the same shape `coach` already has.
  it('refuses practice and says where its list lives', () => {
    expect(() => allowedPaths('practice', SLUG, PATTERN)).toThrow(/practice-chat/)
  })
})

describe('buildPracticeChatPrompt', () => {
  it('carries the README, the stub and the suite', () => {
    const prompt = buildPracticeChatPrompt(root, { slug: SLUG, pattern: PATTERN })
    expect(prompt).toContain('Find the best window.')
    expect(prompt).toContain('export function maxSumWindow')
    // ASCII on purpose. `stripSuiteComments` goes through the TypeScript
    // transpiler, which re-emits non-ASCII string content escaped — the suite's
    // own `— correctness` reaches the tutor as `\u2014`. Harmless (it is still
    // an em dash once evaluated, which is what `classifyFailures` matches on),
    // but asserting the pretty form here would be asserting something untrue.
    expect(prompt).toContain('finds the window')
  })

  /**
   * The tutor gets the *stripped* suite, exactly as the browser does.
   *
   * Four of the repo's real suites name their own pattern directory in a
   * comment, which is hint rung 2 in plain text. Serving the raw file would
   * hand the tutor something the learner's own devtools cannot show them —
   * breaking "knows nothing the learner cannot read" in the direction that
   * matters.
   */
  it('strips the suite comments, so no fixture comment reaches the tutor', () => {
    const prompt = buildPracticeChatPrompt(root, { slug: SLUG, pattern: PATTERN })
    expect(prompt).not.toContain(FIXTURE_COMMENT_SPOILER)
  })

  it('never carries the worked answer', () => {
    const prompt = buildPracticeChatPrompt(root, { slug: SLUG, pattern: PATTERN })
    expect(prompt).not.toContain(WORKED_ANSWER)
  })
})

/**
 * The discipline block, pinned.
 *
 * A real session produced a reply containing three competing versions of one
 * method, a line commented `// placeholder logic — see full fix below`, and a
 * variable annotated `// will be undefined now, but we'll set it back below`.
 * Every *sentence* rule in the prompt was satisfied: none of the banned phrases
 * appeared in prose. The working-out had simply moved inside the code fences,
 * which is worse, because code is what gets copied into the editor.
 *
 * Asserted on the file rather than on a model's output because that is what can
 * be tested deterministically. A model following it is a separate question and
 * a separate measurement — but a rule that is not in the file cannot be
 * followed at all, and this is the file quietly losing it that these guard.
 */
describe('the tutor prompt bans working-out in code, not only in prose', () => {
  const prompt = readFileSync(join(process.cwd(), 'prompts/practice-chat.md'), 'utf8')
  const discipline = /<discipline>([\s\S]*?)<\/discipline>/.exec(prompt)?.[1] ?? ''

  it('has a discipline block at all, and first', () => {
    expect(discipline).not.toBe('')
    expect(prompt.trimStart().startsWith('<discipline>')).toBe(true)
  })

  it('asks for one version of a function per reply', () => {
    expect(discipline).toMatch(/one version of any function/i)
  })

  it('refuses placeholders and code known to be wrong', () => {
    expect(discipline).toMatch(/placeholder/i)
    expect(discipline).toMatch(/must run|would not paste it/i)
  })

  it('refuses a bug annotated as it is being written', () => {
    expect(discipline).toMatch(/annotate a bug/i)
  })

  // The prose rules the code rules sit beside. Losing either half loses the
  // point — the two failure modes are the same failure in two syntaxes.
  it('still bans the phrases it always did', () => {
    for (const phrase of ['wait', 'hold on', 'let me re-check', 'my read so far']) {
      expect(discipline.toLowerCase()).toContain(phrase)
    }
  })
})

describe('codeCue', () => {
  // A tutor that cannot tell "written nothing" from "buffer not sent" opens the
  // same way on a blank editor as on a nearly-finished one.
  it('says an empty buffer is empty rather than omitting it', () => {
    expect(codeCue('   ')).toMatch(/not written anything yet/)
  })

  it('carries the buffer when there is one', () => {
    expect(codeCue('const total = 0')).toContain('const total = 0')
  })
})

describe('POST /api/practice/chat', () => {
  it('streams the tutor’s reply', async () => {
    const { port } = await listen(baseDeps())
    const res = await ask(port, { problem: SLUG, code: '', messages: ONE_QUESTION })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('A sliding window keeps a running total.')
  })

  /**
   * The buffer rides on the final user message, not the system prompt, because
   * a system prompt is built once and the editor changes between questions.
   */
  it('puts the current buffer in front of the question', async () => {
    let seen: { role: string; content: string }[] = []
    const { port } = await listen(
      baseDeps({
        createTransport: () =>
          async function* (_system: string, messages: { role: string; content: string }[]) {
            seen = messages
            yield 'ok'
          },
      }),
    )
    await ask(port, { problem: SLUG, code: 'let left = 0', messages: ONE_QUESTION })
    expect(seen.at(-1)?.content).toContain('let left = 0')
    expect(seen.at(-1)?.content).toContain('What is a sliding window?')
  })

  it('keeps earlier turns, so the tutor can follow a conversation', async () => {
    let seen: { role: string; content: string }[] = []
    const { port } = await listen(
      baseDeps({
        createTransport: () =>
          async function* (_system: string, messages: { role: string; content: string }[]) {
            seen = messages
            yield 'ok'
          },
      }),
    )
    await ask(port, {
      problem: SLUG,
      code: '',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'second' },
      ],
    })
    expect(seen).toHaveLength(3)
    expect(seen[1]?.role).toBe('assistant')
  })

  /**
   * The API-level spoiler gate, which is the only defence the allowlist cannot
   * provide: a route that legitimately resolves the pattern and then forwards
   * it into a response.
   */
  it('never lets the pattern reach the wire', async () => {
    const { port } = await listen(
      baseDeps({
        createTransport: () =>
          async function* (system: string) {
            // Echoing the system prompt is the most hostile thing a transport
            // could do; even then the pattern must not be in it to echo.
            yield system
          },
      }),
    )
    const res = await ask(port, { problem: SLUG, code: '', messages: ONE_QUESTION })
    const body = await res.text()
    expect(body).not.toContain(PATTERN)
    expect(body).not.toContain(WORKED_ANSWER)
  })

  it('rejects a problem name that is not a bare slug', async () => {
    const { port } = await listen(baseDeps())
    const res = await ask(port, { problem: '../../etc/passwd', code: '', messages: ONE_QUESTION })
    expect(res.status).toBe(400)
  })

  it('404s an unknown problem', async () => {
    const { port } = await listen(baseDeps())
    const res = await ask(port, { problem: 'no-such-problem', code: '', messages: ONE_QUESTION })
    expect(res.status).toBe(404)
  })

  // A history whose last entry is the tutor's own reply is a client bug, and
  // answering it anyway would have the model reply to itself.
  it('refuses a history that does not end with the learner', async () => {
    const { port } = await listen(baseDeps())
    const res = await ask(port, {
      problem: SLUG,
      code: '',
      messages: [{ role: 'assistant', content: 'I said this' }],
    })
    expect(res.status).toBe(400)
  })

  it('refuses an empty history', async () => {
    const { port } = await listen(baseDeps())
    const res = await ask(port, { problem: SLUG, code: '', messages: [] })
    expect(res.status).toBe(400)
  })

  // Everything that can fail must fail before the first byte: once headers are
  // on the wire the status is fixed, and an error sentence in the chat is
  // indistinguishable from the tutor saying something odd.
  it('reports a missing prompt file as a status, not as chat text', async () => {
    rmSync(join(root, 'prompts/practice-chat.md'))
    const { port } = await listen(baseDeps())
    const res = await ask(port, { problem: SLUG, code: '', messages: ONE_QUESTION })
    expect(res.status).toBe(500)
  })
})

describe('practice is not a drill', () => {
  /**
   * `practice` is a `Track` only so it gets a row in the per-track backend
   * table. Both track validators are explicit allowlists that omit it, so this
   * already fails closed — asserted here so it stays that way, rather than
   * resting on a property nobody checked.
   */
  it('cannot be started as a session', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'practice', problem: SLUG }),
    })
    expect(res.status).toBe(400)
  })

  it('is not a listable problem track', async () => {
    const { port } = await listen(baseDeps())
    const res = await fetch(`http://127.0.0.1:${port}/api/problems?track=practice`)
    expect(res.status).toBe(400)
  })
})
