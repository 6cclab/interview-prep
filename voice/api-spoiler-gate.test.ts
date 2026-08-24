import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceServer } from './http-server'
import { useCliBackend } from './test-helpers/backend-env'

useCliBackend()

/**
 * The pattern must not appear in any HTTP response, from any route, ever.
 *
 * `voice/spoiler-gate.test.ts` guards what gets *read* off disk. This guards
 * what gets *written* to a socket, which is a different question with a
 * different failure mode: reading a problem's README is both necessary and
 * safe, and the leak everyone is worried about is a route that resolves a
 * problem — legitimately learning its pattern in order to build a path or a
 * prompt — and then puts the resolved object into JSON instead of only the
 * slug.
 *
 * That is not hypothetical and it is not a filesystem question. A deployed
 * instance reads its problems through a privileged database role precisely
 * because hint rung 2 and the coach track need the pattern; the grants stop a
 * *new* route reaching it by accident, but they cannot stop the loader that
 * legitimately has it from forwarding it. This file is the only thing that can.
 *
 * So: a fixture problem whose pattern is a string that appears nowhere else,
 * every route swept, and the assertion made over the raw response body rather
 * than over a parsed field — a field-by-field check only ever knows about the
 * fields its author thought of.
 */

const PATTERN = 'zzz-tell-tale-pattern'
const SLUG = 'fixture-problem'

let server: Server | undefined
let root: string
let port: number

function seed(): void {
  const write = (relPath: string, body: string) => {
    const full = join(root, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  const dir = `problems/${PATTERN}/${SLUG}`
  write(`${dir}/README.md`, '# Fixture\n\nDo a thing.\n')
  write(`${dir}/stub.ts`, 'export function thing(): number {\n  return 0\n}\n')
  write(`${dir}/solution.test.ts`, "import { thing } from './solution'\n\nit('works', () => thing())\n")
  write(`${dir}/solution.ts`, 'export function thing(): number {\n  return 1\n}\n')
  // The pattern is in `meta.yaml`, exactly as it is for every real problem —
  // which is what makes a route that serves the meta file a leak.
  write(`${dir}/meta.yaml`, `pattern: ${PATTERN}\ntitle: Fixture\ndifficulty: easy\nhints:\n  nudge: Think.\n`)
  write('prompts/drill.md', 'DRILL COMMAND')
  write('prompts/mock.md', 'MOCK COMMAND')
  write('prompts/design.md', 'DESIGN COMMAND')
  write('patterns.md', `| ${PATTERN} | a row that must never be served |`)
  write(`solutions/${PATTERN}/${SLUG}.md`, 'THE WORKED ANSWER')
}

function listen(): Promise<number> {
  // No session is ever started here, so the transport is never called — but it
  // is a real `StreamFn` rather than a cast, so a change to that signature
  // breaks this file loudly instead of leaving a lie behind an `as never`.
  server = createVoiceServer({
    root,
    createTransport: () =>
      async function* () {
        yield 'never reached — this file starts no sessions'
      },
    transcriber: { transcribe: async () => ({ text: '' }) },
  })
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo')
      resolve(address.port)
    })
  })
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'voice-api-spoiler-'))
  seed()
  port = await listen()
})

afterEach(() => {
  server?.close()
  server = undefined
  rmSync(root, { recursive: true, force: true })
})

/** Every route reachable without a live session, as raw text. */
async function sweep(): Promise<{ path: string; status: number; body: string }[]> {
  const paths = [
    '/api/problems',
    '/api/problems?track=coding',
    '/api/problems?track=coach',
    '/api/problems?track=assisted',
    '/api/problems?track=design',
    '/api/problems?track=debug',
    `/api/problems/${SLUG}?track=coding`,
    `/api/problems/${SLUG}?track=coach`,
    `/api/problems/${SLUG}?track=assisted`,
    `/api/coding/${SLUG}/exercise`,
    `/api/coding/${SLUG}/solution`,
    '/api/history',
    // The error paths too. A 400 or a 404 that echoes what it was asked about
    // is a response like any other, and `codingPattern` throws a message built
    // from a resolved problem.
    `/api/problems/${SLUG}?track=nonsense`,
    '/api/problems/no-such-problem?track=coding',
    '/api/coding/no-such-problem/exercise',
  ]
  const seen: { path: string; status: number; body: string }[] = []
  for (const path of paths) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`)
    seen.push({ path, status: res.status, body: await res.text() })
  }
  return seen
}

describe('no route ever puts the pattern on the wire', () => {
  it('sweeps every session-free route and finds it nowhere', async () => {
    const responses = await sweep()
    const leaked = responses.filter((r) => r.body.includes(PATTERN))
    expect(leaked.map((r) => `${r.path} -> ${r.body.slice(0, 200)}`)).toEqual([])
  })

  /**
   * The sweep is only worth anything if it would actually notice. Asserting
   * that a fixture pattern is absent from fifteen responses passes trivially if
   * the routes are all 404ing — so this pins that the sweep reached real
   * content, and that the content is the content.
   */
  it('reached real responses, so the absence means something', async () => {
    const responses = await sweep()
    const byPath = new Map(responses.map((r) => [r.path, r]))
    expect(byPath.get('/api/problems?track=coding')!.status).toBe(200)
    expect(byPath.get('/api/problems?track=coding')!.body).toContain(SLUG)
    expect(byPath.get(`/api/problems/${SLUG}?track=coding`)!.body).toContain('Do a thing')
    expect(byPath.get(`/api/coding/${SLUG}/exercise`)!.body).toContain('export function thing')
  })

  /**
   * The exercise route ships the stub and the suite. It must never ship the
   * worked answer — on a shared instance `solution.ts` holds whatever the last
   * person left in it, so seeding a browser workspace from it hands the next
   * candidate a solved problem.
   */
  it('serves the stub from the exercise route, never the solution', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/coding/${SLUG}/exercise`)
    const body = (await res.json()) as { stub: string }
    expect(body.stub).toContain('return 0')
    expect(body.stub).not.toContain('return 1')
    expect(JSON.stringify(body)).not.toContain('THE WORKED ANSWER')
  })

  /**
   * `patterns.md` and `solutions/**` are DENIED files. Nothing here should be
   * able to reach them, but the point of sweeping for their contents rather
   * than for their filenames is that a route which read one and inlined the
   * text would leave no filename behind to find.
   */
  it('serves nothing out of the denied files', async () => {
    for (const { path, body } of await sweep()) {
      expect(`${path}: ${body}`).not.toContain('THE WORKED ANSWER')
      expect(`${path}: ${body}`).not.toContain('must never be served')
    }
  })
})
