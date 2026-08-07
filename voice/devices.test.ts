import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseInputDevices, parseOutputDevices, readDeviceConfig } from './devices'

const FFMPEG_STDERR = [
  '[AVFoundation indev @ 0x72d068000] AVFoundation video devices:',
  '[AVFoundation indev @ 0x72d068000] [0] MacBook Pro Camera',
  '[AVFoundation indev @ 0x72d068000] [1] HD Pro Webcam C920',
  '[AVFoundation indev @ 0x72d068000] AVFoundation audio devices:',
  '[AVFoundation indev @ 0x72d068000] [0] CalDigit USB-C HDMI Audio',
  '[AVFoundation indev @ 0x72d068000] [1] HD Pro Webcam C920',
  '[AVFoundation indev @ 0x72d068000] [3] MacBook Pro Microphone',
].join('\n')

const SAY_STDOUT = ['  108 CalDigit USB-C HDMI Audio', '   75 MacBook Pro Speakers'].join('\n')

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voice-devices-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('parseInputDevices', () => {
  it('returns only audio devices, never video ones', () => {
    expect(parseInputDevices(FFMPEG_STDERR).map((d) => d.name)).toEqual([
      'CalDigit USB-C HDMI Audio',
      'HD Pro Webcam C920',
      'MacBook Pro Microphone',
    ])
  })

  it('formats ids as the avfoundation input string', () => {
    expect(parseInputDevices(FFMPEG_STDERR)[2]).toEqual({
      id: ':3',
      name: 'MacBook Pro Microphone',
    })
  })

  it('does not confuse the camera sharing an index with an audio device', () => {
    const ids = parseInputDevices(FFMPEG_STDERR).map((d) => d.id)
    expect(ids).not.toContain(':0/video')
    expect(parseInputDevices(FFMPEG_STDERR).map((d) => d.name)).not.toContain(
      'MacBook Pro Camera',
    )
  })

  it('returns an empty list when there is no audio section', () => {
    expect(parseInputDevices('[AVFoundation indev @ 0x1] AVFoundation video devices:')).toEqual(
      [],
    )
  })
})

describe('parseOutputDevices', () => {
  it('parses right-aligned ids and names', () => {
    expect(parseOutputDevices(SAY_STDOUT)).toEqual([
      { id: '108', name: 'CalDigit USB-C HDMI Audio' },
      { id: '75', name: 'MacBook Pro Speakers' },
    ])
  })

  it('ignores blank lines', () => {
    expect(parseOutputDevices(`\n${SAY_STDOUT}\n\n`)).toHaveLength(2)
  })
})

describe('readDeviceConfig', () => {
  function writeConfig(body: string) {
    mkdirSync(join(root, 'local'), { recursive: true })
    writeFileSync(join(root, 'local/voice.json'), body)
  }

  it('reads both devices', () => {
    writeConfig('{ "input": ":3", "output": "75" }')
    expect(readDeviceConfig(root)).toEqual({ input: ':3', output: '75' })
  })

  it('returns an empty config when the file is absent', () => {
    expect(readDeviceConfig(root)).toEqual({})
  })

  it('returns an empty config rather than throwing on malformed JSON', () => {
    writeConfig('{ not json')
    expect(readDeviceConfig(root)).toEqual({})
  })

  it('ignores non-string values rather than passing them to a subprocess', () => {
    writeConfig('{ "input": 3, "output": null }')
    expect(readDeviceConfig(root)).toEqual({})
  })
})
