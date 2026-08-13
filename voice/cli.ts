import { createInterface } from 'node:readline/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { record } from './audio'
import { streamForBackend } from './backend'
import { timeCue, buildSystemPrompt, type Track } from './context'
import { listInputDevices, listOutputDevices, listVoices, readDeviceConfig, resolveSpeech } from './devices'
import { createInterviewer } from './interviewer'
import { runSession } from './session'
import { resolveSpeaker, saySpeaker, whisperTranscriber } from './speech'
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
  const configured = readDeviceConfig(root, null)
  return {
    input: process.env.MIC_DEVICE ?? configured.input,
    output: process.env.SAY_DEVICE ?? configured.output,
  }
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

/**
 * A line to audition a voice on. Deliberately something the interviewer would
 * actually say: a voice judged on "Hello, my name is Ava" sounds fine and then
 * turns out to mangle every technical clause in a real drill.
 */
const AUDITION =
  'Right — before you write anything, talk me through the brute force. ' +
  'What is the cost of that, in time and in space?'

/**
 * List the English voices by tier, and speak a sample in one if asked.
 *
 * The tiers are the whole point. macOS ships only legacy voices by default, and
 * no amount of configuration makes those sound human — so when none are
 * installed this says so and names the exact place to fix it, rather than
 * printing a list that looks like a working set of choices.
 */
async function printVoices(requested?: string): Promise<void> {
  const root = process.cwd()
  const speech = resolveSpeech(readDeviceConfig(root, null))
  const english = (await listVoices()).filter((v) => v.locale.startsWith('en'))

  if (requested) {
    const match = english.find((v) => v.name.toLowerCase() === requested.toLowerCase())
    if (!match) {
      console.error(`No English voice named "${requested}". Run \`pnpm voice:voices\` for the list.`)
      process.exit(1)
    }
    console.log(`${match.name} (${match.tier}), saying:\n  "${AUDITION}"\n`)
    // The configured rate, so what you hear is what a drill will sound like —
    // auditioning at a different pace than the drill runs at defeats the point.
    const { output } = resolveDevices(root)
    await saySpeaker({ voice: match.name, rate: speech.rate, audioDevice: output }).speak(AUDITION)
    return
  }

  for (const tier of ['premium', 'enhanced', 'legacy'] as const) {
    const inTier = english.filter((v) => v.tier === tier)
    if (inTier.length === 0) continue
    console.log(`${tier} (${inTier.length}):`)
    for (const v of inTier) {
      console.log(`  ${v.name === speech.voice ? '*' : ' '} ${v.name}  ${v.locale}`)
    }
    console.log()
  }

  if (!english.some((v) => v.tier !== 'legacy')) {
    console.log('No Enhanced or Premium voice is installed, and that is the whole ballgame —')
    console.log('every voice above is a pre-neural system voice that will sound robotic however')
    console.log('it is configured. Download one (a few hundred MB, needs your password):')
    console.log('  System Settings > Accessibility > Spoken Content > System Voice > Manage Voices')
    console.log('Ava, Evan, Zoe, Joelle and Serena all have Premium builds. Then:')
    console.log('  pnpm voice:voices "Ava (Premium)"     # audition it')
    console.log('  # and put the winner in local/voice.json:')
    console.log('  { "voice": "Ava (Premium)", "rate": 170 }')
    return
  }

  console.log('Audition one, then write the winner to local/voice.json:')
  console.log('  pnpm voice:voices "Ava (Premium)"')
  console.log('  { "voice": "Ava (Premium)", "rate": 170 }')
}

async function main(): Promise<void> {
  const track = process.argv[2] as Track | 'devices' | 'voices' | undefined
  const problem = process.argv[3]

  if (track === 'devices') {
    await printDevices()
    return
  }

  if (track === 'voices') {
    await printVoices(problem)
    return
  }

  if (track !== 'mock' && track !== 'design') {
    console.error(
      'Usage: pnpm mock:voice | pnpm design:voice <problem> | pnpm voice:devices | pnpm voice:voices [voice]',
    )
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

  const interviewer = createInterviewer(buildSystemPrompt(root, null, track, problem), streamForBackend(track))

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
      speaker: resolveSpeaker({ audioDevice: devices.output, ...resolveSpeech(readDeviceConfig(root, null)) }),
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
    const relPath = writeSession(root, null, sessionPath(track, startedAt, problem), formatSession(entries, startedAt))
    console.log(`\nTranscript: ${relPath}`)

    const { log } = splitTrailer(interviewer.lastRaw())
    if (track === 'mock' && log) {
      appendStoryLog(root, null, log)
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
