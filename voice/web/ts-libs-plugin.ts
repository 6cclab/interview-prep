import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * `import libs from 'virtual:ts-libs'` — the TypeScript standard library, as
 * text, for the assist Worker to type-check against.
 *
 * A language service needs `lib.es2022.d.ts` and everything it references, and
 * those are 45 files that ship inside `node_modules/typescript` rather than
 * anywhere the browser can reach. Three ways to close that gap, and this is the
 * third:
 *
 * 1. **Fetch them from a CDN at runtime** (what `@typescript/vfs` does by
 *    default). Rejected: it makes a local drill depend on a third party being
 *    up, and the editor would silently lose its type checker whenever the
 *    network did.
 * 2. **Vendor them into the source tree** with a generator script and a test
 *    that they are current. Rejected: 425KB of checked-in generated `.d.ts`
 *    that must be regenerated on every TypeScript bump, and a stale copy fails
 *    as *wrong types* rather than as a missing file.
 * 3. **Resolve them at build time from the version already installed.** No
 *    network, nothing checked in, and it cannot drift from `package.json`
 *    because it is read out of `package.json`'s own resolution.
 *
 * The closure is walked rather than hardcoded: `lib.es2022.d.ts` is a handful
 * of `/// <reference lib="…" />` lines and nothing else, and the set they pull
 * in changes between TypeScript releases. A hardcoded list would go subtly
 * wrong on an upgrade — one missing file means one missing global, which
 * surfaces as a red squiggle under a real standard-library name.
 */

const MODULE_ID = 'virtual:ts-libs'
const RESOLVED_ID = `\0${MODULE_ID}`

/** Must match `DEFAULT_LIB` in `src/assist/service.ts`, which is the file that asks for it. */
const ENTRY = 'lib.es2022.d.ts'

export function readTypeScriptLibs(entry: string = ENTRY): Record<string, string> {
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
  walk(entry)
  return libs
}

export function tsLibs(): Plugin {
  return {
    name: 'ts-libs',
    resolveId(id) {
      return id === MODULE_ID ? RESOLVED_ID : null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      // `JSON.stringify` of the whole map rather than a module per file: this
      // is data, it is only ever consumed as a whole, and one string literal
      // parses faster in the browser than 45 module records.
      return `export default ${JSON.stringify(readTypeScriptLibs())}`
    },
  }
}
