/**
 * The deployed build, running on this machine, in one command.
 *
 * There are two processes because there have to be: the container is a
 * deployed instance and refuses a request that carries no identity, and the
 * identity has to be stamped by something outside it — a server flag that
 * accepted an identity it was never given would be an auth bypass one
 * misconfiguration away from production. But that is an argument for two
 * processes, not for two commands and two ports to keep straight, so this
 * starts both and prints one URL.
 *
 * For an ordinary drill, use `pnpm mock:web`. None of this applies there.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { startEdge } from './deploy-edge'

const NAME = 'interview-prep'
const IMAGE = 'interview-prep:local'
const UPSTREAM = Number(process.env.EDGE_UPSTREAM ?? 4199)

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
  const model = existsSync(models) && spawnSync('sh', ['-c', `ls ${models}/*.bin`]).status === 0
  if (!model) {
    console.log(`No *.bin in ${models} — the UI will work and spoken turns will not.`)
  }

  // A leftover from a previous run holds the port and would otherwise fail
  // with a message about the port rather than about the container.
  docker(['rm', '-f', NAME])

  // No `--rm`. A container that refuses to start is exactly the one whose logs
  // are worth reading, and `--rm` deletes it before anything can — the failure
  // becomes "No such container", which says nothing. It is removed on the way
  // in and on the way out instead.
  const started = docker([
    'run', '-d', '--name', NAME,
    '-p', `${UPSTREAM}:4173`,
    '-v', `${models}:/opt/whisper/models:ro`,
    '-e', `VOICE_BACKEND=${process.env.VOICE_BACKEND ?? 'ollama'}`,
    '-e', `OLLAMA_HOST=${process.env.OLLAMA_HOST ?? ''}`,
    '-e', `OLLAMA_API_KEY=${process.env.OLLAMA_API_KEY ?? ''}`,
    '-e', `VOICE_GATEWAY_SECRET=${process.env.VOICE_GATEWAY_SECRET ?? ''}`,
    IMAGE,
  ])
  if (started.status !== 0) {
    console.error(started.stderr.trim())
    process.exit(1)
  }

  // The container exits rather than starts on a bad OLLAMA_HOST or an unknown
  // VOICE_MODE, and its own message says exactly which. Waiting for the edge to
  // 502 instead would throw that message away.
  setTimeout(() => {
    if (docker(['inspect', '-f', '{{.State.Running}}', NAME]).stdout.trim() !== 'true') {
      console.error('\nThe container exited. Its last words:\n')
      console.error(docker(['logs', NAME]).stdout || docker(['logs', NAME]).stderr)
      process.exit(1)
    }
    startEdge()
  }, 1500)

  const stop = (): void => {
    docker(['rm', '-f', NAME])
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
