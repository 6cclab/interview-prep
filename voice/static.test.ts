import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cacheControlFor, resolveStaticFile } from './static'

let dirs: string[] = []

// `resolveStaticFile` returns a `realpath`-resolved path, which on macOS
// canonicalises `/tmp` to `/private/tmp`. Returning the already-realpath'd
// directory here keeps every `join(dist, ...)` comparison in these tests
// pointed at the same canonical form, rather than each test re-deriving it.
function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('resolveStaticFile', () => {
  it('serves a file that exists inside the dist root', () => {
    const dist = tempDir('static-ok-')
    writeFileSync(join(dist, 'app.js'), 'console.log(1)')
    const resolved = resolveStaticFile(dist, '/app.js')
    expect(resolved?.path).toBe(join(dist, 'app.js'))
    expect(resolved?.contentType).toContain('text/javascript')
  })

  it('maps / to index.html', () => {
    const dist = tempDir('static-root-')
    writeFileSync(join(dist, 'index.html'), '<html></html>')
    expect(resolveStaticFile(dist, '/')?.path).toBe(join(dist, 'index.html'))
  })

  it('returns null for a file that does not exist inside the dist root', () => {
    const dist = tempDir('static-404-')
    writeFileSync(join(dist, 'index.html'), '<html></html>')
    expect(resolveStaticFile(dist, '/nope.js')).toBeNull()
  })

  // Traversal case 1: a literal `../` payload.
  it('refuses a literal ../ traversal, however many segments deep', () => {
    const dist = tempDir('static-trav-')
    writeFileSync(join(dist, 'index.html'), '<html></html>')
    for (const payload of [
      '/../etc/passwd',
      '/../../etc/passwd',
      '/../../../../../../../../../../etc/passwd',
      '/assets/../../../../etc/passwd',
    ]) {
      expect(resolveStaticFile(dist, payload)).toBeNull()
    }
  })

  // Traversal case 2: percent-encoded, which the WHATWG URL parser passes
  // through undecoded — this is the payload a naive implementation that
  // checked for a literal "../" substring *before* decoding would miss.
  it('refuses a percent-encoded ../ traversal (%2e%2e%2f)', () => {
    const dist = tempDir('static-enc-')
    writeFileSync(join(dist, 'index.html'), '<html></html>')
    for (const payload of [
      '/%2e%2e/etc/passwd',
      '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/%2e%2e%2fetc%2fpasswd',
    ]) {
      expect(resolveStaticFile(dist, payload)).toBeNull()
    }
  })

  // Traversal case 3: an absolute-path payload. This must land back inside
  // `distRoot` (as `distRoot/etc/passwd`, which doesn't exist) rather than
  // resolving to the real filesystem root.
  it('contains an absolute path payload inside the dist root instead of following it', () => {
    const dist = tempDir('static-abs-')
    writeFileSync(join(dist, 'index.html'), '<html></html>')
    expect(resolveStaticFile(dist, '//etc/passwd')).toBeNull()
    expect(resolveStaticFile(dist, '/etc/passwd')).toBeNull()

    // Prove containment positively, not just "it happened to 404": a file
    // placed at the contained location IS served.
    writeFileSync(join(dist, 'passwd'), 'not actually /etc/passwd')
    expect(resolveStaticFile(dist, '/passwd')?.path).toBe(join(dist, 'passwd'))
  })

  // Traversal case 4: a symlink inside the dist root whose target escapes
  // it. Lexical containment of the *requested* path is not enough once
  // symlinks exist — the resolved real path must be checked too.
  it('refuses a symlink inside dist that escapes the dist root', () => {
    const dist = tempDir('static-sym-')
    const outside = tempDir('static-outside-')
    writeFileSync(join(outside, 'secret.txt'), 'top secret')
    symlinkSync(join(outside, 'secret.txt'), join(dist, 'leak.txt'))

    expect(resolveStaticFile(dist, '/leak.txt')).toBeNull()
  })

  it('rejects malformed percent-encoding rather than throwing', () => {
    const dist = tempDir('static-malformed-')
    writeFileSync(join(dist, 'index.html'), '<html></html>')
    expect(() => resolveStaticFile(dist, '/%')).not.toThrow()
    expect(resolveStaticFile(dist, '/%')).toBeNull()
  })

  it('refuses a null-byte payload', () => {
    const dist = tempDir('static-nullbyte-')
    writeFileSync(join(dist, 'index.html'), '<html></html>')
    expect(resolveStaticFile(dist, '/index.html%00.png')).toBeNull()
  })

  it('does not serve a directory', () => {
    const dist = tempDir('static-dir-')
    mkdirSync(join(dist, 'assets'), { recursive: true })
    writeFileSync(join(dist, 'assets', 'placeholder.js'), 'x')
    expect(resolveStaticFile(dist, '/assets')).toBeNull()
  })
})

/**
 * Cache headers, which the server previously sent none of.
 *
 * "No `Cache-Control`" is not "do not cache" — with no header and no validator
 * a browser applies its own heuristic, and Chrome duly cached `index.html`.
 * A rebuild then left the tab loading the *old* asset hashes across reloads.
 * Deployed that is worse: the old hashes are gone from the new image, so a
 * returning visitor gets a 404 for every script on the page and renders a
 * white screen rather than an error.
 */
describe('cacheControlFor', () => {
  // The shell names the hashed assets, so it is the one file that must always
  // be refetched. This is what makes pinning the others safe.
  it('never stores the shell', () => {
    expect(cacheControlFor('/dist/index.html')).toBe('no-store')
  })

  it.each([
    'assets/index-DuwZfKad.js',
    'assets/index-D7tTsWSc.css',
    'assets/geist-sans-latin-400-normal-BOaIZNA2.woff2',
  ])('pins %s forever, because its name changes when its bytes do', (name) => {
    expect(cacheControlFor(`/dist/${name}`)).toBe('public, max-age=31536000, immutable')
  })

  /**
   * Matched on the hash, not on the directory. An unhashed file that happened
   * to live in `assets/` would otherwise be pinned in every browser for a year
   * with no way to recall it — the one cache mistake that cannot be undone by
   * deploying again.
   */
  it('does not pin an unhashed file just because of where it lives', () => {
    expect(cacheControlFor('/dist/assets/logo.svg')).toBe('no-cache')
    expect(cacheControlFor('/dist/favicon.ico')).toBe('no-cache')
  })

  // A short hash is not a content hash. Vite's are 8 characters.
  it('does not mistake a hyphenated name for a hashed one', () => {
    expect(cacheControlFor('/dist/assets/my-icon.svg')).toBe('no-cache')
  })
})

describe('resolveStaticFile cache headers', () => {
  it('carries the header alongside the content type', () => {
    const root = mkdtempSync(join(tmpdir(), 'static-cache-'))
    writeFileSync(join(root, 'index.html'), '<!doctype html>')
    expect(resolveStaticFile(root, '/')?.cacheControl).toBe('no-store')
    rmSync(root, { recursive: true, force: true })
  })
})
