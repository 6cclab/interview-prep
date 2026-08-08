import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

export interface ResolvedStaticFile {
  path: string
  contentType: string
}

/**
 * Resolves an HTTP pathname to a file inside `distRoot`, refusing anything
 * that would escape it.
 *
 * This replaces a fixed `STATIC_FILES` lookup table keyed by literal
 * pathname — traversal was structurally impossible there because the table
 * never touched the filesystem with anything derived from the request.
 * Vite's content-hashed output filenames make that table unworkable (the
 * hash isn't known ahead of time), so this has to accept an arbitrary
 * requested path and enforce containment itself:
 *
 *  - A literal `../` is caught by resolving the decoded path against
 *    `distRoot` and checking the result is still inside it.
 *  - `%2e%2e%2f` (percent-encoded `../`) is caught the same way — the
 *    WHATWG `URL` parser does not decode percent-encoded dot segments, so
 *    they arrive in `pathname` untouched and only become `..` once this
 *    function's own `decodeURIComponent` runs, which is why the containment
 *    check has to happen *after* decoding, not before.
 *  - An absolute path payload (e.g. `/etc/passwd`) is caught the same way
 *    too: stripped of its leading slash and joined against `distRoot`, it
 *    becomes `distRoot/etc/passwd`, which is still contained (and, absent a
 *    real file there, simply not found).
 *  - A symlink *inside* `distRoot` whose target escapes it is caught by a
 *    second containment check against the file's real path, taken only
 *    after confirming the path exists — lexical containment of the
 *    requested path is not sufficient once a symlink can point anywhere.
 */
export function resolveStaticFile(distRoot: string, pathname: string): ResolvedStaticFile | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null

  const root = resolve(distRoot)
  if (!existsSync(root)) return null
  const rootReal = realpathSync(root)

  const relPath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const joined = resolve(root, relPath)
  if (joined !== root && !joined.startsWith(root + sep)) return null

  if (!existsSync(joined)) return null
  if (lstatSync(joined).isDirectory()) return null

  const real = realpathSync(joined)
  if (real !== rootReal && !real.startsWith(rootReal + sep)) return null

  const contentType = CONTENT_TYPES[extname(real)] ?? 'application/octet-stream'
  return { path: real, contentType }
}

export function readStaticFile(resolved: ResolvedStaticFile): Buffer {
  return readFileSync(resolved.path)
}
