/**
 * The deployed build, running on this machine.
 *
 * There used to be a proxy in front of this, standing in for Traefik and the
 * Authentik outpost, because the container refused any request that carried no
 * identity header. It does not ask any more — an instance is one person's — so
 * there is one process, one port, and nothing to sign in as.
 *
 * For an ordinary drill, use `pnpm mock:web`. None of this applies there.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const NAME = 'interview-prep'
const IMAGE = 'interview-prep:local'
const PORT = Number(process.env.PORT ?? 4199)

function docker(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync('docker', args, { encoding: 'utf8' })
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }
}

function main(): void {
  if (docker(['image', 'inspect', IMAGE]).status !== 0) {
    console.error(`No ${IMAGE} image yet. Build it with \`pnpm deploy:image\`.`)
    process.exit(1)
  }

  // The model is mounted, never baked — 1.5G, and it changes on a different
  // cadence than the image. `models/` is untracked, so a git worktree has an
  // empty one unless it has been symlinked at the main checkout's copy.
  const models = join(process.cwd(), 'models')
  if (!existsSync(models) || spawnSync('sh', ['-c', `ls ${models}/*.bin`]).status !== 0) {
    console.log(`No *.bin in ${models} — the UI will work and spoken turns will not.`)
  }

  // A leftover from a previous run holds the port, and the failure would be
  // about the port rather than about the container.
  docker(['rm', '-f', NAME])

  // No `--rm`. A container that refuses to start is exactly the one whose logs
  // are worth reading, and `--rm` deletes it before anything can — the failure
  // becomes "No such container", which says nothing.
  const started = docker([
    'run', '-d', '--name', NAME,
    '-p', `${PORT}:4173`,
    '-v', `${models}:/opt/whisper/models:ro`,
    '-e', `VOICE_BACKEND=${process.env.VOICE_BACKEND ?? 'ollama'}`,
    '-e', `OLLAMA_HOST=${process.env.OLLAMA_HOST ?? ''}`,
    '-e', `OLLAMA_API_KEY=${process.env.OLLAMA_API_KEY ?? ''}`,
    IMAGE,
  ])
  if (started.status !== 0) {
    console.error(started.stderr.trim())
    process.exit(1)
  }

  // The container exits rather than starts on a bad OLLAMA_HOST or an unknown
  // VOICE_MODE, and its own message says exactly which. Reporting a refused
  // connection instead would throw that message away.
  setTimeout(() => {
    if (docker(['inspect', '-f', '{{.State.Running}}', NAME]).stdout.trim() !== 'true') {
      console.error('\nThe container exited. Its last words:\n')
      const logs = docker(['logs', NAME])
      console.error(logs.stdout || logs.stderr)
      process.exit(1)
    }
    console.log(`\n  Open http://127.0.0.1:${PORT}`)
    console.log('  Ctrl-C stops it.')
  }, 1500)

  const stop = (): void => {
    docker(['rm', '-f', NAME])
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  // Nothing else holds the loop open now that the proxy is gone.
  setInterval(() => {}, 1 << 30)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
