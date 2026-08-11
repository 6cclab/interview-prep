import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TRACK_VARS } from '../voice/backend'

/**
 * The invariant lived only in prose, and drifted: `VOICE_BACKEND_COACH` and
 * `VOICE_BACKEND_DEBUG` were added after the scripts were written and no script
 * was updated, so a stale export survived `pnpm mock:web:claude` — exactly the
 * "a transport you did not choose" failure the design forbids.
 *
 * Derived from TRACK_VARS rather than a second hand-written list, so adding a
 * sixth track breaks this test instead of silently exempting itself.
 */
describe('the mock:web:* scripts', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  // Excludes `mock:web:vague`: that script only sets `VOICE_VAGUE` and forwards
  // to plain `mock:web`, so it inherits whatever backend the environment (or a
  // chained provider script) already set rather than choosing one itself. It is
  // a modifier, not a provider, so it is deliberately not in this list.
  const provider = Object.entries(pkg.scripts).filter(([name]) => /^mock:web:(claude|openai|ollama|hybrid)$/.test(name))

  it('exist for every provider', () => {
    expect(provider.map(([name]) => name).sort()).toEqual([
      'mock:web:claude',
      'mock:web:hybrid',
      'mock:web:ollama',
      'mock:web:openai',
    ])
  })

  it.each(provider)('%s sets every track variable', (_name, body) => {
    for (const variable of TRACK_VARS) {
      expect(body).toMatch(new RegExp(`(^|\\s)${variable}=`))
    }
  })

  it.each(provider)('%s sets the global variable too', (_name, body) => {
    expect(body).toMatch(/(^|\s)VOICE_BACKEND=/)
  })
})
