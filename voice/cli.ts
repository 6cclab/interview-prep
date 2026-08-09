import Anthropic from '@anthropic-ai/sdk'
import { createInterface } from 'node:readline/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { record } from './audio'
import { claudeCliStream, DEFAULT_CLAUDE_MODEL } from './claude-cli'
import { chooseBackend, describeBackend } from './backend'
import { DEFAULT_OLLAMA_MODEL, ollamaStream } from './ollama'
import { timeCue, buildSystemPrompt, type Track } from './context'
import { listInputDevices, listOutputDevices, readDeviceConfig } from './devices'
import { anthropicStream, createInterviewer, type StreamFn } from './interviewer'
import { runSession } from './session'
import { saySpeaker, whisperTranscriber } from './speech'
import { transcriptionPrompt } from './vocabulary'
import {
  appendStoryLog,
  formatSession,
  sessionPath,
  splitTrailer,
  writeSession,
} from './transcript'

const WHISPER_BINARY = process.env.WHISPER_BINARY ?? 'whisper-cli'
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? 'models/ggml-large-v3-turbo.bin'

/**
 * Device resolution order: env var, then `local/voice.json`, then the system
 * default. There is deliberately no hardcoded index fallback — on this machine
 * avfoundation audio `:0` is an HDMI input, so a wrong default records silence,
 * which looks identical to a broken microphone.
 */
function resolveDevices(root: string): { input?: string; output?: string } {
  const configured = readDeviceConfig(root)
  return {
    input: process.env.MIC_DEVICE ?? configured.input,
    output: process.env.SAY_DEVICE ?? configured.output,
  }
}

/**
 * The transport for this track, and what it spends, printed so a drill never
 * silently comes out of the wrong pocket.
 *
 * Chosen per track by `voice/backend.ts` — the same selection the browser
 * server uses, so `VOICE_BACKEND_DESIGN=ollama` means the same thing whether
 * the design drill is run here or in the browser.
 */
function chooseTransport(track: Track): StreamFn {
  const backend = chooseBackend(track)
  if (backend === 'ollama') {
    console.log(describeBackend('ollama', process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL))
    return ollamaStream()
  }
  const model = process.env.VOICE_CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL
  if (backend === 'api') {
    console.log(describeBackend('api', model))
    return anthropicStream(new Anthropic(), model)
  }
  console.log(describeBackend('cli', model))
  return claudeCliStream({ model })
}

async function printDevices(): Promise<void> {
  const [inputs, outputs] = await Promise.all([listInputDevices(), listOutputDevices()])
  console.log('Inputs (microphones):')
  for (const d of inputs) console.log(`  ${d.id}  ${d.name}`)
  console.log('\nOutputs (speakers):')
  for (const d of outputs) console.log(`  ${d.id}  ${d.name}`)
  console.log('\nWrite the ones you want to local/voice.json, e.g.:')
  console.log('  { "input": ":3", "output": "75" }')
}

async function main(): Promise<void> {
  const track = process.argv[2] as Track | 'devices' | undefined
  const problem = process.argv[3]

  if (track === 'devices') {
    await printDevices()
    return
  }

  if (track !== 'mock' && track !== 'design') {
    console.error('Usage: pnpm mock:voice | pnpm design:voice <problem> | pnpm voice:devices')
    process.exit(1)
  }
  if (track === 'design' && !problem) {
    console.error('Usage: pnpm design:voice <problem>')
    process.exit(1)
  }

  const root = process.cwd()
  const scratch = mkdtempSync(join(tmpdir(), 'voice-drill-'))
  const devices = resolveDevices(root)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const startedAt = new Date()
  const started = Date.now()

  const interviewer = createInterviewer(buildSystemPrompt(root, track, problem), chooseTransport(track))

  if (!devices.input) {
    // Silently defaulting here is the trap: an unconfigured index can point at
    // an HDMI input, and a silent recording is indistinguishable from a broken
    // microphone until the transcript comes back empty.
    console.log('No input device configured — using the avfoundation default.')
    console.log('If nothing is transcribed, run `pnpm voice:devices` and set local/voice.json.\n')
  }

  console.log('Recording. Press Enter to hand the turn back. Type "end" to finish.\n')

  try {
    const entries = await runSession({
      transcriber: whisperTranscriber({ binary: WHISPER_BINARY, model: WHISPER_MODEL }),
      speaker: saySpeaker({ voice: process.env.SAY_VOICE, audioDevice: devices.output }),
      interviewer,
      startRecording: () => record(scratch, devices.input),
      nextTurn: async () => ((await rl.question('')).trim() === 'end' ? 'end' : 'speak'),
      now: () => Date.now() - started,
      // The live design drill is timed, and the interviewer has no clock of its
      // own — without this each turn it is told nothing and design.md's "warn
      // once at ten minutes, stop at time" is unfollowable. The web path does
      // the same; this keeps the terminal from being the clockless one.
      turnCue: track === 'design' ? () => timeCue(Date.now() - started) : undefined,
      // The same vocabulary bias the browser path uses, so a terminal drill is
      // not the one transcribing "O of n" as "on".
      transcriptionPrompt: transcriptionPrompt(track),
    })

    // The path written may differ from the one asked for — `writeSession` will
    // not overwrite an existing transcript — so print what it actually used,
    // not what was requested. Otherwise a collision sends Andre looking for a
    // file that isn't where the terminal said it was.
    const relPath = writeSession(root, sessionPath(track, startedAt, problem), formatSession(entries, startedAt))
    console.log(`\nTranscript: ${relPath}`)

    const { log } = splitTrailer(interviewer.lastRaw())
    if (track === 'mock' && log) {
      appendStoryLog(root, log)
      console.log('Story bank: local/stories.md')
    }
  } finally {
    rl.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exit(1)
})
