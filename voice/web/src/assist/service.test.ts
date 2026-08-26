import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { AMBIENT, DEFAULT_LIB, createAssistService } from './service'

/**
 * The lib sources, read off disk.
 *
 * The Worker gets these from a Vite virtual module instead — see
 * `voice/web/vite.config.ts`. Both callers walk the same `/// <reference lib=`
 * chain from the same starting file, which is the property that matters: a test
 * that type-checked against a different standard library than the browser does
 * would be evidence about nothing.
 */
function readLibs(): Record<string, string> {
  const dir = dirname(createRequire(import.meta.url).resolve('typescript'))
  const libs: Record<string, string> = {}
  const walk = (name: string): void => {
    if (libs[name] !== undefined) return
    const source = readFileSync(join(dir, name), 'utf8')
    libs[name] = source
    for (const match of source.matchAll(/\/\/\/\s*<reference\s+lib="([^"]+)"/g)) {
      walk(`lib.${match[1]!}.d.ts`)
    }
  }
  walk(DEFAULT_LIB)
  return libs
}

const LIBS = readLibs()

/**
 * The buffer that started this.
 *
 * Reproduced verbatim rather than reduced to a minimal case, because the
 * minimal case is not what the service has to survive: this is a real
 * half-finished class with a doc comment, private fields, `strict`-relevant
 * `Map.get` returns, and exactly one typo. If the diagnostics are readable here
 * they are readable where it counts.
 */
const TYPO = `export class Cache {
  private store: Map<number, number>
  private capacity: number
  constructor(capacity: number) {
    this.store = new Map()
    this.capacity = capacity
  }
  get(key: number): number {
    if (!this.store.has(key)) {
      return -1
    }
    const val = this.store.get(key)!
    this.store.delete(key)
    this.store.set(key, val)
    return val
  }
  put(key: number, value: number): void {
    const oldest = this.map.keys().next().value
    if (this.capacity === this.map.size && !this.store.has(key)) {
      this.store.delete(oldest)
    }
    this.store.delete(key)
    this.store.set(key, value)
  }
}
`

/**
 * The same class with the two `this.map` references corrected, and nothing else.
 *
 * Still not clean, and that is the point of keeping it as its own fixture: the
 * typo was never the only thing wrong. See the test below it.
 */
const RENAMED = TYPO.replaceAll('this.map', 'this.store')

/**
 * `RENAMED`, plus the guard the second diagnostic asks for.
 *
 * `Map.keys().next().value` is `number | undefined` — the iterator protocol
 * cannot promise a value, even from a map you have just checked the size of —
 * so passing it to `delete` is an error under `strict`. At runtime
 * `delete(undefined)` is a harmless no-op, which is exactly why this is the
 * kind of thing a type checker is for and a test run is not.
 */
const CLEAN = RENAMED.replace(
  'if (this.capacity === this.store.size && !this.store.has(key)) {\n      this.store.delete(oldest)',
  'if (oldest !== undefined && this.capacity === this.store.size && !this.store.has(key)) {\n      this.store.delete(oldest)',
)

describe('the typo that cost an afternoon', () => {
  it('names the missing property, and points at it', () => {
    const service = createAssistService(LIBS, TYPO)
    const found = service.diagnostics()

    const missing = found.filter((d) => /Property 'map' does not exist/.test(d.message))
    // Two references to `this.map`, so two diagnostics — not one summary for
    // the file. The second is on a different line and has to be squiggled
    // there, or fixing the first leaves a run that still fails for a reason the
    // editor has stopped mentioning.
    expect(missing).toHaveLength(2)

    // The span covers the property name itself, so the underline sits under
    // `map` rather than under the whole statement.
    for (const diagnostic of missing) {
      expect(TYPO.slice(diagnostic.from, diagnostic.to)).toBe('map')
      expect(diagnostic.severity).toBe('error')
    }
  })

  it('still objects to the eviction key once the typo is gone', () => {
    // The typo hid this. `oldest` is `number | undefined` and `delete` wants a
    // `number`; at runtime that is a silent no-op rather than a crash, so no
    // test run would ever have said a word about it. Asserted here so that a
    // future loosening of the compiler options — dropping `strict` to quieten
    // the editor, say — fails visibly instead of quietly giving up the one
    // class of bug this service is best at.
    const service = createAssistService(LIBS, RENAMED)
    expect(service.diagnostics().map((d) => d.message)).toEqual([
      expect.stringContaining("Argument of type 'number | undefined'"),
    ])
  })

  it('goes quiet once the code is actually right', () => {
    // The other half of the proof. A checker that reports an error on every
    // buffer is not detecting anything, and this is the assertion that tells
    // the two apart.
    const service = createAssistService(LIBS, CLEAN)
    expect(service.diagnostics()).toEqual([])
  })

  it('follows an edit rather than answering from the buffer it was built with', () => {
    const service = createAssistService(LIBS, TYPO)
    expect(service.diagnostics()).not.toEqual([])
    service.update(CLEAN)
    expect(service.diagnostics()).toEqual([])
    service.update(TYPO)
    expect(service.diagnostics()).not.toEqual([])
  })
})

describe('completions', () => {
  it('offers the class own members after `this.`', () => {
    const source = `export class Cache {
  private store = new Map<number, number>()
  private capacity = 0
  get(key: number): number { return -1 }
  put(key: number, value: number): void {
    this.
  }
}
`
    const service = createAssistService(LIBS, source)
    const labels = service.completions(source.indexOf('this.') + 'this.'.length).map((c) => c.label)
    expect(labels).toEqual(expect.arrayContaining(['store', 'capacity', 'get', 'put']))
  })

  it('types a member so the list can be iconed', () => {
    const source = `export class Cache {
  private store = new Map<number, number>()
  put(): void {
    this.
  }
}
`
    const service = createAssistService(LIBS, source)
    const entries = service.completions(source.indexOf('this.') + 'this.'.length)
    expect(entries.find((c) => c.label === 'store')?.type).toBe('property')
    expect(entries.find((c) => c.label === 'put')?.type).toBe('function')
  })

  it('knows the standard library, which is the reason the lib files are shipped at all', () => {
    const source = `const m = new Map<number, number>()\nm.\n`
    const service = createAssistService(LIBS, source)
    const labels = service.completions(source.indexOf('m.\n') + 2).map((c) => c.label)
    expect(labels).toEqual(expect.arrayContaining(['get', 'set', 'has', 'delete', 'size']))
  })

  it('resolves a signature only for the entry asked about', () => {
    const source = `const m = new Map<number, number>()\nm.\n`
    const service = createAssistService(LIBS, source)
    const detail = service.completionDetail(source.indexOf('m.\n') + 2, 'has')
    expect(detail?.signature).toContain('boolean')
  })
})

describe('ambient globals', () => {
  it('accepts console.log and performance.now, which solutions really use', () => {
    const service = createAssistService(
      LIBS,
      `export function f(): number {\n  console.log('x', 1)\n  return performance.now()\n}\n`,
    )
    expect(service.diagnostics()).toEqual([])
  })

  it('does not quietly ship the DOM', () => {
    // The narrowness is the decision — see `AMBIENT`. If someone widens this to
    // `lib.dom.d.ts` to fix one missing name, the completion list for a Worker
    // file grows by several thousand irrelevant entries, and this is the test
    // that makes that a choice rather than an accident.
    const service = createAssistService(LIBS, `export const el = document.body\n`)
    expect(service.diagnostics().map((d) => d.message)).toEqual([
      expect.stringContaining("Cannot find name 'document'"),
    ])
    expect(AMBIENT).not.toContain('document')
  })
})

describe('quick info', () => {
  it('reports the type under the cursor', () => {
    const source = `const total: number = 1\nconst x = total\n`
    const service = createAssistService(LIBS, source)
    const info = service.quickInfo(source.indexOf('total') + 1)
    expect(info?.signature).toContain('number')
  })
})

describe('agreement with the repo tsconfig', () => {
  it('enforces strict, which is what `pnpm typecheck` enforces', () => {
    // `Map.get` returns `number | undefined`, and returning it where `number`
    // is declared is an error under `strict`. An editor looser than the build
    // is worse than no editor: it teaches you that its silence means nothing.
    const service = createAssistService(
      LIBS,
      `export class C {\n  private m = new Map<number, number>()\n  get(k: number): number {\n    return this.m.get(k)\n  }\n}\n`,
    )
    expect(service.diagnostics()).not.toEqual([])
  })

  it('enforces noUncheckedIndexedAccess, which it also enforces', () => {
    const service = createAssistService(
      LIBS,
      `export function first(xs: number[]): number {\n  return xs[0]\n}\n`,
    )
    expect(service.diagnostics()).not.toEqual([])
  })
})
