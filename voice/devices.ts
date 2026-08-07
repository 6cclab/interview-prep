import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface Device {
  id: string
  name: string
}

const AUDIO_HEADER = /AVFoundation audio devices:/
const VIDEO_HEADER = /AVFoundation video devices:/
const DEVICE_LINE = /\[(\d+)\]\s+(.*)$/

/**
 * Parse `ffmpeg -f avfoundation -list_devices true -i ""`, which writes to
 * stderr and lists video devices before audio ones. Indices restart per
 * section and names can repeat across them, so the section must be tracked —
 * grepping for `[N] Name` alone would offer cameras as microphones.
 */
export function parseInputDevices(stderr: string): Device[] {
  const devices: Device[] = []
  let inAudio = false
  for (const line of stderr.split('\n')) {
    if (VIDEO_HEADER.test(line)) {
      inAudio = false
      continue
    }
    if (AUDIO_HEADER.test(line)) {
      inAudio = true
      continue
    }
    if (!inAudio) continue
    const match = DEVICE_LINE.exec(line)
    if (match) devices.push({ id: `:${match[1]}`, name: match[2]!.trim() })
  }
  return devices
}

/** Parse `say -a '?'` — right-aligned numeric id, then the device name. */
export function parseOutputDevices(stdout: string): Device[] {
  const devices: Device[] = []
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (match) devices.push({ id: match[1]!, name: match[2]!.trim() })
  }
  return devices
}

export async function listInputDevices(): Promise<Device[]> {
  // This invocation always exits non-zero — it lists devices, then fails to
  // open the empty input. The device list is on stderr either way.
  try {
    const { stderr } = await run('ffmpeg', [
      '-hide_banner',
      '-f', 'avfoundation',
      '-list_devices', 'true',
      '-i', '',
    ])
    return parseInputDevices(stderr)
  } catch (error) {
    return parseInputDevices(String((error as { stderr?: string }).stderr ?? ''))
  }
}

export async function listOutputDevices(): Promise<Device[]> {
  const { stdout } = await run('say', ['-a', '?'])
  return parseOutputDevices(stdout)
}

export interface DeviceConfig {
  input?: string
  output?: string
}

/**
 * Read `local/voice.json`. Device ids are machine-specific and shift when a
 * headset is plugged in, so they live in gitignored local config rather than a
 * committed default. Any problem reading it yields an empty config — a bad
 * config file must not stop a drill from starting.
 */
export function readDeviceConfig(root: string): DeviceConfig {
  const path = join(root, 'local/voice.json')
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    const { input, output } = parsed as Record<string, unknown>
    const config: DeviceConfig = {}
    if (typeof input === 'string') config.input = input
    if (typeof output === 'string') config.output = output
    return config
  } catch {
    return {}
  }
}
