import type { Device } from './devices'
import { LiveRefused } from './live'

/**
 * The command-line surface of `/live`, as pure functions.
 *
 * Argument parsing and device resolution live here rather than in `cli.ts`
 * because both are decisions that can go wrong silently — the wrong device
 * records the wrong room, a missing flag records without a confirmation — and
 * neither is testable while it is tangled up with readline and ffmpeg.
 */

export interface LiveArgs {
  mode: 'live' | 'debrief'
  company: string
  round: string
  /** avfoundation index (`:2`) or a device-name substring. */
  device?: string
  headphones: boolean
  segmentSeconds: number
}

/** Thrown for a usage error, so `main` can print it without a stack trace. */
export class LiveUsage extends Error {}

export const LIVE_USAGE =
  'Usage: pnpm voice:live --company <name> [--round <name>] --device <:N|name> --headphones\n' +
  '       pnpm voice:debrief --company <name> [--round <name>] [--device <:N|name>]\n' +
  '\n' +
  '  --company     who the round was with. Names the file.\n' +
  '  --round       "technical screen", "final round". Defaults to "interview".\n' +
  '  --device      your microphone, by name or index. `pnpm voice:devices` lists them.\n' +
  '                Prefer the name: avfoundation renumbers when a device connects.\n' +
  '  --headphones  confirms the interviewer is not audible in the room. Required for --live.\n' +
  '  --segment-minutes  how often to close a segment. Defaults to 5.'

/**
 * Parse `live` / `debrief` arguments.
 *
 * `--headphones` is a flag rather than a prompt on purpose: it has to be a
 * visible thing he typed. A y/n prompt at the top of a 45-minute capture is
 * answered reflexively and reads, afterwards, as nothing at all — whereas a
 * flag in shell history is a record of a decision.
 */
export function parseLiveArgs(mode: 'live' | 'debrief', argv: string[]): LiveArgs {
  const args: LiveArgs = {
    mode,
    company: '',
    round: 'interview',
    headphones: false,
    segmentSeconds: 300,
  }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = (): string => {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) throw new LiveUsage(`${flag} needs a value.`)
      i++
      return next
    }
    switch (flag) {
      case '--company':
        args.company = value()
        break
      case '--round':
        args.round = value()
        break
      case '--device':
        args.device = value()
        break
      case '--headphones':
        args.headphones = true
        break
      case '--segment-minutes': {
        const minutes = Number(value())
        // A zero or negative segment length makes ffmpeg roll over continuously
        // and produces thousands of unusable files; a non-number silently
        // becomes NaN seconds, which ffmpeg rejects forty minutes later.
        if (!Number.isFinite(minutes) || minutes <= 0) {
          throw new LiveUsage('--segment-minutes must be a positive number.')
        }
        args.segmentSeconds = Math.round(minutes * 60)
        break
      }
      default:
        throw new LiveUsage(`Unknown option ${flag}.`)
    }
  }

  if (args.company.trim() === '') throw new LiveUsage('--company is required.')
  return args
}

/**
 * Which microphone to record from.
 *
 * There is no default, and that is the point. `record()` falls back to the
 * avfoundation default because a silent practice drill costs nothing; here the
 * device decides *whose voice is captured*, and an unnamed default cannot be
 * checked against the loopback list at all. A device this cannot name is a
 * device `assertCapturable` cannot clear, so it refuses rather than recording
 * something it cannot describe.
 *
 * Matching by *name* is not a convenience — it is the safer of the two forms.
 * avfoundation indices are positions in a list that changes: unplugging an
 * interface or a phone going out of range renumbers everything after it, and
 * `pnpm voice:devices` printed `:3  MacBook Pro Microphone` and then `:0
 * MacBook Pro Microphone` ninety seconds apart while this was being built. An
 * index written down before a round can point at a different microphone by the
 * time the round starts, and nothing about the recording would say so.
 */
export function resolveCaptureDevice(devices: Device[], requested?: string): Device {
  if (requested === undefined || requested.trim() === '') {
    throw new LiveRefused(
      'No microphone given. Pass --device with the one you are actually speaking into — ' +
        'run `pnpm voice:devices` to list them. There is no default here on purpose: an ' +
        'unnamed device cannot be checked against the loopback list.',
    )
  }
  const wanted = requested.trim()
  // `parseInputDevices` stores ids as `:2`, but the colon is shell noise and
  // gets dropped as often as it is typed. Normalise both sides rather than
  // letting `2` fall through to the name match, where it hits every device with
  // a `2` in its name — "BlackHole 2ch" and "Scarlett 2i2" both do.
  const colon = (id: string): string => (id.startsWith(':') ? id : `:${id}`)
  const byId = devices.find((d) => colon(d.id) === colon(wanted))
  if (byId) return byId

  const lowered = wanted.toLowerCase()
  const byName = devices.filter((d) => d.name.toLowerCase().includes(lowered))
  if (byName.length === 1) return byName[0]!
  if (byName.length > 1) {
    throw new LiveRefused(
      `"${requested}" matches ${byName.length} devices: ${byName.map((d) => d.name).join(', ')}. ` +
        'Use the index instead.',
    )
  }
  throw new LiveRefused(
    `No input device matches "${requested}". Run \`pnpm voice:devices\` for the list.`,
  )
}

/** The avfoundation argument for a resolved device — `:2`, never a bare index. */
export function avfoundationInput(device: Device): string {
  return device.id.startsWith(':') ? device.id : `:${device.id}`
}
