import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  parseInputDevices,
  parseOutputDevices,
  parseVoices,
  readDeviceConfig,
  resolveSpeech,
  writeDeviceConfig,
} from './devices'

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
    expect(readDeviceConfig(root, null)).toEqual({ input: ':3', output: '75' })
  })

  it('returns an empty config when the file is absent', () => {
    expect(readDeviceConfig(root, null)).toEqual({})
  })

  it('returns an empty config rather than throwing on malformed JSON', () => {
    writeConfig('{ not json')
    expect(readDeviceConfig(root, null)).toEqual({})
  })

  it('ignores non-string values rather than passing them to a subprocess', () => {
    writeConfig('{ "input": 3, "output": null }')
    expect(readDeviceConfig(root, null)).toEqual({})
  })

  it('reads a webInput field, distinct from input', () => {
    writeConfig('{ "input": ":3", "webInput": "browser-device-abc" }')
    expect(readDeviceConfig(root, null)).toEqual({ input: ':3', webInput: 'browser-device-abc' })
  })
})

describe('writeDeviceConfig', () => {
  it('creates local/ and the file when neither exists yet', () => {
    writeDeviceConfig(root, null, { output: '75' })
    expect(readDeviceConfig(root, null)).toEqual({ output: '75' })
  })

  it('merges with the existing config rather than clobbering unrelated fields', () => {
    writeDeviceConfig(root, null, { input: ':3' })
    writeDeviceConfig(root, null, { output: '75' })
    expect(readDeviceConfig(root, null)).toEqual({ input: ':3', output: '75' })
  })

  it('overwrites only the field it is given', () => {
    writeDeviceConfig(root, null, { output: '75', webInput: 'old-id' })
    writeDeviceConfig(root, null, { webInput: 'new-id' })
    expect(readDeviceConfig(root, null)).toEqual({ output: '75', webInput: 'new-id' })
  })

  it('returns the merged config it wrote', () => {
    writeDeviceConfig(root, null, { input: ':3' })
    expect(writeDeviceConfig(root, null, { output: '75' })).toEqual({ input: ':3', output: '75' })
  })
})

// Real `say -v '?'` output. The awkward names are the point: two of them contain
// spaces and nested brackets, so any attempt to tokenise the name side splits
// them wrongly — which is why `parseVoices` anchors on the locale instead.
const VOICES_STDOUT = [
  'Albert              en_US    # Hello! My name is Albert.',
  'Ava (Premium)       en_US    # Hello! My name is Ava.',
  'Daniel (Enhanced)   en_GB    # Hello! My name is Daniel.',
  'Eddy (English (UK)) en_GB    # Hello! My name is Eddy.',
  'Grandma (English (US)) en_US    # Hello! My name is Grandma.',
  'Anna                de_DE    # Hallo! Ich heiße Anna.',
  '',
].join('\n')

describe('parseVoices', () => {
  it('reads the name, locale and tier of every voice', () => {
    expect(parseVoices(VOICES_STDOUT)).toEqual([
      { name: 'Albert', locale: 'en_US', tier: 'legacy' },
      { name: 'Ava (Premium)', locale: 'en_US', tier: 'premium' },
      { name: 'Daniel (Enhanced)', locale: 'en_GB', tier: 'enhanced' },
      { name: 'Eddy (English (UK))', locale: 'en_GB', tier: 'legacy' },
      { name: 'Grandma (English (US))', locale: 'en_US', tier: 'legacy' },
      { name: 'Anna', locale: 'de_DE', tier: 'legacy' },
    ])
  })

  it('keeps a name containing spaces and nested brackets whole', () => {
    const eddy = parseVoices(VOICES_STDOUT).find((v) => v.name.startsWith('Eddy'))
    // Not 'Eddy', and not 'Eddy (English' — the whole thing, because that string
    // is what `say -v` has to be given back.
    expect(eddy?.name).toBe('Eddy (English (UK))')
  })

  it('ignores blank lines and anything without a locale', () => {
    expect(parseVoices('\n\nnot a voice line\n')).toEqual([])
  })
})

describe('readDeviceConfig — voice and rate', () => {
  // The same helper as the block above; `root` is per-test, so it cannot be hoisted
  // to module scope without capturing a stale temp directory.
  function writeConfig(body: string) {
    mkdirSync(join(root, 'local'), { recursive: true })
    writeFileSync(join(root, 'local/voice.json'), body)
  }

  it('reads a voice name and a rate', () => {
    writeConfig('{ "voice": "Ava (Premium)", "rate": 170 }')
    expect(readDeviceConfig(root, null)).toEqual({ voice: 'Ava (Premium)', rate: 170 })
  })

  it('drops a rate that is not a usable number rather than poisoning the utterance', () => {
    // `say -r` on any of these fails the whole sentence, so the rate is dropped
    // and the voice's default is used — a bad rate costs the rate, not the drill.
    for (const bad of ['"fast"', '0', '-40', 'null', 'true']) {
      writeConfig(`{ "voice": "Ava (Premium)", "rate": ${bad} }`)
      expect(readDeviceConfig(root, null)).toEqual({ voice: 'Ava (Premium)' })
    }
  })

  it('drops a blank voice name, which would select nothing', () => {
    writeConfig('{ "voice": "   ", "output": "75" }')
    expect(readDeviceConfig(root, null)).toEqual({ output: '75' })
  })

  it('does not lose voice or rate when another field is written', () => {
    writeConfig('{ "voice": "Ava (Premium)", "rate": 170 }')
    writeDeviceConfig(root, null, { output: '75' })
    expect(readDeviceConfig(root, null)).toEqual({ voice: 'Ava (Premium)', rate: 170, output: '75' })
  })
})

describe('resolveSpeech', () => {
  it('uses the config when the environment says nothing', () => {
    expect(resolveSpeech({ voice: 'Ava (Premium)', rate: 170 }, {})).toEqual({
      voice: 'Ava (Premium)',
      rate: 170,
    })
  })

  it('lets the environment override the file', () => {
    expect(resolveSpeech({ voice: 'Ava (Premium)', rate: 170 }, { SAY_VOICE: 'Evan (Premium)', SAY_RATE: '150' })).toEqual(
      { voice: 'Evan (Premium)', rate: 150 },
    )
  })

  it('falls back to the file when SAY_RATE is unusable, rather than to no rate', () => {
    expect(resolveSpeech({ rate: 170 }, { SAY_RATE: 'quickly' })).toEqual({ rate: 170 })
  })

  it('returns nothing at all when neither source has anything', () => {
    // An empty object matters: `saySpeaker` omits the flag entirely for an absent
    // voice or rate, which is how the system default gets used.
    expect(resolveSpeech({}, {})).toEqual({})
  })
})
