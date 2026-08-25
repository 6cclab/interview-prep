import { describe, expect, it } from 'vitest'
import { LiveRefused } from './live'
import { avfoundationInput, LiveUsage, parseLiveArgs, resolveCaptureDevice } from './live-cli'

describe('parseLiveArgs', () => {
  it('reads the round it is about to record', () => {
    const args = parseLiveArgs('live', [
      '--company', 'Talkspace',
      '--round', 'technical screen',
      '--device', ':2',
      '--headphones',
    ])
    expect(args).toEqual({
      mode: 'live',
      company: 'Talkspace',
      round: 'technical screen',
      device: ':2',
      headphones: true,
      segmentSeconds: 300,
    })
  })

  it('defaults the round rather than demanding one', () => {
    expect(parseLiveArgs('live', ['--company', 'Talkspace']).round).toBe('interview')
  })

  /**
   * A flag, not a prompt. A y/n at the top of a 45-minute capture is answered
   * reflexively and afterwards reads as nothing; a flag in shell history is a
   * record that the decision was made.
   */
  it('defaults headphones to unconfirmed', () => {
    expect(parseLiveArgs('live', ['--company', 'X']).headphones).toBe(false)
  })

  it('names the file after the company, so it is required', () => {
    expect(() => parseLiveArgs('live', ['--device', ':2'])).toThrow(LiveUsage)
    expect(() => parseLiveArgs('live', ['--company', '   '])).toThrow(/--company is required/)
  })

  it('converts segment minutes to seconds', () => {
    expect(parseLiveArgs('live', ['--company', 'X', '--segment-minutes', '2']).segmentSeconds).toBe(120)
  })

  /**
   * Zero rolls ffmpeg over continuously into thousands of unusable files, and a
   * non-number becomes NaN seconds — which ffmpeg rejects, but not until the
   * round has already started.
   */
  it.each(['0', '-3', 'five'])('refuses --segment-minutes %s', (value) => {
    expect(() => parseLiveArgs('live', ['--company', 'X', '--segment-minutes', value])).toThrow(
      LiveUsage,
    )
  })

  // `--company --headphones` would otherwise record a company literally called
  // "--headphones" and silently drop the confirmation.
  it('does not swallow the next flag as a value', () => {
    expect(() => parseLiveArgs('live', ['--company', '--headphones'])).toThrow(
      /--company needs a value/,
    )
  })

  it('rejects an option it does not know rather than ignoring it', () => {
    expect(() => parseLiveArgs('live', ['--company', 'X', '--headphone'])).toThrow(/Unknown option/)
  })

  it('carries the mode it was invoked as', () => {
    expect(parseLiveArgs('debrief', ['--company', 'X']).mode).toBe('debrief')
  })
})

describe('resolveCaptureDevice', () => {
  const devices = [
    { id: ':0', name: 'MacBook Pro Microphone' },
    { id: ':1', name: 'BlackHole 2ch' },
    { id: ':2', name: 'Scarlett 2i2 USB' },
  ]

  it('resolves by avfoundation index', () => {
    expect(resolveCaptureDevice(devices, ':2').name).toBe('Scarlett 2i2 USB')
  })

  it('accepts the index without the colon', () => {
    expect(resolveCaptureDevice(devices, '2').name).toBe('Scarlett 2i2 USB')
  })

  it('resolves by a name substring', () => {
    expect(resolveCaptureDevice(devices, 'scarlett').id).toBe(':2')
  })

  /**
   * No default, deliberately. `record()` may fall back to the avfoundation
   * default because a silent practice drill costs nothing. Here the device
   * decides whose voice is captured, and an unnamed default cannot be checked
   * against the loopback list at all.
   */
  it('refuses rather than guessing when no device was given', () => {
    expect(() => resolveCaptureDevice(devices)).toThrow(LiveRefused)
    expect(() => resolveCaptureDevice(devices, '  ')).toThrow(/voice:devices/)
  })

  // Recording the wrong one of two matches is not a small error here.
  it('refuses an ambiguous name instead of picking one', () => {
    const two = [
      { id: ':0', name: 'Studio Display Microphone' },
      { id: ':1', name: 'Studio Microphone' },
    ]
    expect(() => resolveCaptureDevice(two, 'studio')).toThrow(/matches 2 devices/)
  })

  it('refuses a name that matches nothing', () => {
    expect(() => resolveCaptureDevice(devices, 'yeti')).toThrow(/No input device matches/)
  })

  /**
   * Resolution does not clear a device — `assertCapturable` does. A loopback
   * resolves fine by name and is refused one step later; keeping the two apart
   * means the safety check has one owner.
   */
  it('resolves a loopback device, leaving the refusal to the gate', () => {
    expect(resolveCaptureDevice(devices, 'blackhole').name).toBe('BlackHole 2ch')
  })
})

describe('avfoundationInput', () => {
  it('passes through an id that already carries the colon', () => {
    expect(avfoundationInput({ id: ':2', name: 'x' })).toBe(':2')
  })

  it('adds one that does not', () => {
    expect(avfoundationInput({ id: '2', name: 'x' })).toBe(':2')
  })
})
