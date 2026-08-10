import { describe, expect, it } from 'vitest'
import { backendSummary, chooseBackend, DEFAULT_BACKEND, describeBackend, transportLabel } from './backend'

describe('chooseBackend', () => {
  it('defaults every track to the claude CLI when nothing is set', () => {
    expect(chooseBackend('mock', {})).toBe('cli')
    expect(chooseBackend('design', {})).toBe('cli')
    expect(chooseBackend('coding', {})).toBe('cli')
    expect(DEFAULT_BACKEND).toBe('cli')
  })

  it('applies the global variable to every track', () => {
    const env = { VOICE_BACKEND: 'ollama' }
    expect(chooseBackend('mock', env)).toBe('ollama')
    expect(chooseBackend('design', env)).toBe('ollama')
    expect(chooseBackend('coding', env)).toBe('ollama')
  })

  it('lets a track override the global', () => {
    const env = { VOICE_BACKEND: 'ollama', VOICE_BACKEND_CODING: 'cli' }
    expect(chooseBackend('mock', env)).toBe('ollama')
    expect(chooseBackend('coding', env)).toBe('cli')
  })

  // The hybrid the whole per-track knob exists for: a local model on the
  // behavioural track, which has no spoiler to leak and no fenced trailer to
  // emit, and Claude on the two that do.
  it('expresses the recommended hybrid', () => {
    const env = { VOICE_BACKEND_MOCK: 'ollama' }
    expect(chooseBackend('mock', env)).toBe('ollama')
    expect(chooseBackend('design', env)).toBe('cli')
    expect(chooseBackend('coding', env)).toBe('cli')
  })

  it('accepts any case and surrounding whitespace', () => {
    expect(chooseBackend('mock', { VOICE_BACKEND: ' Ollama ' })).toBe('ollama')
    expect(chooseBackend('mock', { VOICE_BACKEND: 'API' })).toBe('api')
  })

  // `VOICE_BACKEND= pnpm mock:web` is the documented way to clear an inherited
  // export for one run; treating an empty string as an error would make that
  // idiom fail instead of doing the obvious thing.
  it('treats an empty or blank value as unset', () => {
    expect(chooseBackend('mock', { VOICE_BACKEND: '' })).toBe('cli')
    expect(chooseBackend('mock', { VOICE_BACKEND: '   ' })).toBe('cli')
    expect(chooseBackend('mock', { VOICE_BACKEND: 'ollama', VOICE_BACKEND_MOCK: '' })).toBe('ollama')
  })

  // A typo silently running a 45-minute drill on the expensive path is the
  // exact failure this refuses to have.
  it('throws on an unknown value rather than falling back', () => {
    expect(() => chooseBackend('mock', { VOICE_BACKEND: 'olama' })).toThrow(/VOICE_BACKEND="olama"/)
    expect(() => chooseBackend('mock', { VOICE_BACKEND: 'olama' })).toThrow(/cli, api, ollama/)
  })

  it('names the track variable in the error when the track variable is the bad one', () => {
    expect(() => chooseBackend('coding', { VOICE_BACKEND_CODING: 'gpt' })).toThrow(
      /VOICE_BACKEND_CODING="gpt"/,
    )
  })

  it('does not read the wrong track variable', () => {
    const env = { VOICE_BACKEND_MOCK: 'ollama' }
    expect(chooseBackend('design', env)).toBe('cli')
    expect(chooseBackend('coding', env)).toBe('cli')
  })
})

describe('describeBackend', () => {
  // The cost clause is the reason this string exists at all: which pocket a
  // drill comes out of should be on screen before the drill.
  it('names the model and what it spends', () => {
    expect(describeBackend('cli', 'claude-sonnet-5')).toContain('claude-sonnet-5')
    expect(describeBackend('cli', 'claude-sonnet-5')).toMatch(/subscription/)
    expect(describeBackend('api', 'claude-sonnet-5')).toMatch(/Console credits/)
    expect(describeBackend('ollama', 'qwen3:30b-a3b')).toMatch(/local, spending nothing/)
    expect(describeBackend('ollama', 'qwen3:30b-a3b')).toContain('qwen3:30b-a3b')
  })
})

describe('backendSummary', () => {
  it('reports every track', () => {
    expect(backendSummary({ VOICE_BACKEND_MOCK: 'ollama' })).toEqual({
      debug: 'cli',
      mock: 'ollama',
      design: 'cli',
      coding: 'cli',
      coach: 'cli',
    })
  })

  // Coaching teaches rather than asks, and no suite contradicts a confident
  // wrong explanation — so putting the drills on a local model must not move
  // the teaching there by implication.
  it('does not move coaching onto a local model with the drills', () => {
    const env = { VOICE_BACKEND_MOCK: 'ollama', VOICE_BACKEND_CODING: 'ollama' }
    expect(backendSummary(env).coach).toBe('cli')
    expect(chooseBackend('coach', { VOICE_BACKEND_COACH: 'ollama' })).toBe('ollama')
  })

  // Startup calls this, so an invalid value surfaces before a drill rather
  // than at the first turn.
  it('throws at startup on an invalid value', () => {
    expect(() => backendSummary({ VOICE_BACKEND: 'nope' })).toThrow(/not a known backend/)
  })
})

/**
 * The line a transcript carries about what produced it.
 *
 * Exists because a drill on 2026-08-10 read wrong and the file said nothing
 * about which model had conducted it — the diagnosis had to lean on a commit
 * timestamp instead.
 */
describe('transportLabel', () => {
  it('names the backend and the Claude model by default', () => {
    expect(transportLabel('coding', {})).toBe('cli / claude-sonnet-5')
  })

  it('names the ollama model when a track is local', () => {
    expect(transportLabel('mock', { VOICE_BACKEND_MOCK: 'ollama', OLLAMA_MODEL: 'Qwen3.5:9b' })).toBe(
      'ollama / Qwen3.5:9b',
    )
  })

  // Per track, like every other backend decision here: a hybrid is the expected
  // arrangement, so two transcripts written the same evening can legitimately
  // name different models.
  it('is per track', () => {
    const env = { VOICE_BACKEND: 'cli', VOICE_BACKEND_MOCK: 'ollama' }
    expect(transportLabel('mock', env)).toMatch(/^ollama \//)
    expect(transportLabel('coding', env)).toMatch(/^cli \//)
  })

  it('reports the override model rather than the default', () => {
    expect(transportLabel('design', { VOICE_CLAUDE_MODEL: 'claude-opus-5' })).toBe('cli / claude-opus-5')
  })
})
