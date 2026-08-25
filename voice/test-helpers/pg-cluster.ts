import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A throwaway Postgres, for the tests that cannot be written against a mock.
 *
 * The entire risk surface of `voice/db` is SQL and grants: whether `REVOKE`
 * actually stops a `select pattern from problem`, whether a row-level policy
 * actually filters. A fake client would answer every one of those questions by
 * agreeing with whatever the code under test believed, which is the opposite of
 * a test. So this starts a real cluster.
 *
 * ---
 *
 * **TCP, not a Unix socket.** The socket path is capped at 103 bytes and a
 * temporary directory under a long project path blows past that; the failure is
 * a confusing `psql: error: Unix-domain socket path ... is too long` that names
 * neither the cluster nor the test. `-h 127.0.0.1` sidesteps the limit entirely
 * and is what a deployment connects over anyway. The server still *opens* a
 * socket, so it is pointed at the throwaway directory — see `startCluster`.
 *
 * **Not a vitest `globalSetup`.** `vitest.config.ts` explains why the repo has
 * none: a globalSetup runs for every `vitest run`, including a single coding
 * drill under `problems/**`, which is the daily loop and has nothing to do with
 * a database. One test file owns the cluster in a `beforeAll` instead.
 */

export interface Cluster {
  /** A `postgres://` URL for a superuser connection to a fresh database. */
  url: string
  stop(): void
}

/** Whether a cluster can be started here at all. */
export function postgresAvailable(): boolean {
  return spawnSync('initdb', ['--version'], { stdio: 'ignore' }).status === 0
}

/**
 * A message worth failing on, when Postgres is missing.
 *
 * The DB tests skip rather than fail when there is no `initdb`, because a
 * machine without Postgres should still be able to run a coding drill. Skipping
 * silently would be worse than either: the gate would go green having verified
 * none of the grants it exists to verify.
 */
export const NO_POSTGRES =
  'Postgres is not installed (no `initdb` on PATH) — the voice/db tests are being skipped, ' +
  'so nothing here has verified the grants or the row-level policies. `brew install postgresql@14`.'

export function startCluster(port = 55_432): Cluster {
  // `mkdtemp` under the OS temp dir, which is short on macOS and Linux alike.
  // The data directory has no length limit; the socket does, and this keeps it
  // well under.
  const dir = mkdtempSync(join(tmpdir(), 'voice-pg-'))
  const data = join(dir, 'data')
  const logFile = join(dir, 'log')

  const run = (bin: string, args: string[]): void => {
    execFileSync(bin, args, { stdio: 'pipe' })
  }

  try {
    // `--auth=trust` is correct here and nowhere else: the cluster listens on
    // loopback, holds fixtures, and is deleted at the end of the file.
    run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--no-sync'])
    run('pg_ctl', [
      '-D',
      data,
      '-w',
      '-o',
      // `unix_socket_directories` is pointed at the throwaway directory rather
      // than left at the build's default, and that default is the whole reason
      // this is here: Debian and Ubuntu compile it to `/var/run/postgresql`,
      // which exists and is owned by the `postgres` user. Anyone else gets
      // `pg_ctl: could not start server` with the actual cause — a socket the
      // server may not create — only in the log file. Homebrew defaults to
      // `/tmp`, so this never fails on a Mac and always fails on CI.
      //
      // Connections still go over TCP; this only gives the socket somewhere
      // legal to live. The directory is short, so the 103-byte path cap the
      // header comment describes is not in play.
      `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${dir} ` +
        `-c fsync=off -c full_page_writes=off`,
      '-l',
      logFile,
      'start',
    ])
  } catch (err) {
    // The postmaster's own log, before the directory holding it is deleted.
    //
    // Without this the failure is `pg_ctl: could not start server` and nothing
    // else, because every interesting line went to a file that this `catch`
    // then removes. That cost a full CI round trip to diagnose once.
    let log = ''
    try {
      log = readFileSync(logFile, 'utf8').trim()
    } catch {
      log = '(the postmaster wrote no log)'
    }
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`${err instanceof Error ? err.message : String(err)}\n\npostgres log:\n${log}`)
  }

  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    stop() {
      // `-m immediate`: there is nothing here worth a clean shutdown, and a
      // checkpoint on the way out is time the gate pays on every run.
      spawnSync('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' })
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
