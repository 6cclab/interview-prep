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
  /** What to send as `cache-control`. See `cacheControlFor`. */
  cacheControl: string
}

/**
 * Vite's content-hashed output: `index-DuwZfKad.js`, `geist-sans-…-BOaIZNA2.woff2`.
 *
 * The hash is the whole point — the name changes when the bytes change, so the
 * file at a given name can never change and may be cached forever. Matched
 * rather than assumed from the directory, because an unhashed file living in
 * `assets/` would otherwise be pinned in every browser for a year with no way
 * to recall it.
 */
const HASHED = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/

/**
 * The `cache-control` for one file.
 *
 * The server sent no cache headers at all, which is not "no caching" — with no
 * `Cache-Control` and no validator, a browser applies its own heuristic. Chrome
 * duly cached `index.html`, and a rebuild then left the tab loading the *old*
 * asset hashes across reloads. Deployed, that is worse than it sounds: the old
 * hashes are gone from the new image, so a returning visitor gets 404s for
 * every script on the page and renders a white screen rather than an error.
 * Hit during development, which is the only reason it was noticed at all.
 *
 * So the shell is never stored and the hashed assets are stored forever. That
 * pairing is the whole mechanism: the immutable files are safe precisely
 * because the one mutable file that names them is always refetched.
 */
export function cacheControlFor(realPath: string): string {
  if (extname(realPath) === '.html') return 'no-store'
  if (HASHED.test(realPath)) return 'public, max-age=31536000, immutable'
  // Everything else — `favicon.ico`, `robots.txt`, an unhashed asset. Cacheable
  // but revalidated, so it can be replaced by a deploy without waiting a year.
  return 'no-cache'
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
  return { path: real, contentType, cacheControl: cacheControlFor(real) }
}

export function readStaticFile(resolved: ResolvedStaticFile): Buffer {
  return readFileSync(resolved.path)
}
