import { join } from 'node:path'

/**
 * Which directory holds one person's practice record.
 *
 * `local/` was one person's directory because the server was one person's
 * server. A deployed instance has to namespace it, and every existing caller
 * has to keep landing on exactly the path it lands on today — so `null` is not
 * a default or a fallback, it is the local mode, and it returns `local/`
 * unchanged. That equality is what makes "local instances keep working exactly
 * as they are" a property of the code rather than an intention.
 */

// Deliberately narrow. The id reaches this function from a request header, and
// this is the only thing between that header and a path join. A `.` or `..`
// segment matches most "safe characters" patterns while still escaping, so
// both are named rather than left to the character class.
const SAFE_USER_ID = /^[A-Za-z0-9._-]+$/
const TRAVERSAL = new Set(['.', '..'])

/**
 * Whether an id can name a directory here.
 *
 * Exported so `deriveUserId` can refuse at the trust boundary and return null,
 * which the caller turns into the 401 it always was. Without it the bad id
 * travels as authenticated and only dies at the `userDataDir` throw below —
 * surfacing a request with no usable identity as an internal error.
 */
export function isSafeUserId(userId: string): boolean {
  return SAFE_USER_ID.test(userId) && !TRAVERSAL.has(userId)
}

export function userDataDir(root: string, userId: string | null): string {
  if (userId === null) return join(root, 'local')
  if (!isSafeUserId(userId)) {
    // Refused, not sanitised. A id needing repair is not one this server
    // issued, so it is a bug or an attack; quietly correcting it would write
    // someone's drill log into a directory nobody can account for.
    throw new Error(`Invalid user id: ${JSON.stringify(userId)}`)
  }
  return join(root, 'local/users', userId)
}
