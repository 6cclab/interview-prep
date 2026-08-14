import { describe, expect, it } from 'vitest'
import { assertOllamaReachable, serverConfig } from './server-config'

describe('serverConfig', () => {
  // The hard requirement of the whole deployed-mode change: an instance with
  // no VOICE_MODE set is the machine you are sitting at, unchanged.
  it('is local when nothing says otherwise', () => {
    const config = serverConfig({})
    expect(config.mode).toBe('local')
    expect(config.host).toBe('127.0.0.1')
    expect(config.speaks).toBe(true)
  })

  it('is deployed when VOICE_MODE says so', () => {
    expect(serverConfig({ VOICE_MODE: 'deployed' }).mode).toBe('deployed')
  })

  /**
   * A typo must not quietly mean "local". Local mode has no identity check and
   * no per-user directories, so a deployed instance that fell back to it would
   * serve every user out of one candidate's `local/` with no login — the
   * loudest possible failure is the safe one.
   */
  it('refuses a mode it does not recognise rather than assuming local', () => {
    expect(() => serverConfig({ VOICE_MODE: 'Deployed ' })).not.toThrow()
    expect(() => serverConfig({ VOICE_MODE: 'production' })).toThrow(/VOICE_MODE/)
  })

  // 127.0.0.1 inside a container is reachable only from that container, so the
  // service in front of it gets a connection refused on every request.
  it('binds every interface when deployed, because a container is not the host', () => {
    expect(serverConfig({ VOICE_MODE: 'deployed' }).host).toBe('0.0.0.0')
  })

  /**
   * `voice/speech.ts` spawns `say` or `piper` on the machine the server runs
   * on. Deployed, that machine is not the user's, so the server must neither
   * speak nor require a TTS engine to be installed before it will start.
   */
  it('does not speak when deployed', () => {
    expect(serverConfig({ VOICE_MODE: 'deployed' }).speaks).toBe(false)
  })

  it('reads the coach allowlist as a comma-separated list', () => {
    expect([...serverConfig({ VOICE_COACH_ALLOWLIST: 'ak-andre, ak-sam' }).coachAllowlist]).toEqual([
      'ak-andre',
      'ak-sam',
    ])
  })

  // An empty entry would put '' in the set, and an empty uid is exactly what a
  // header-stripping mistake produces.
  it('drops blank entries from the allowlist', () => {
    expect([...serverConfig({ VOICE_COACH_ALLOWLIST: 'ak-andre,,  ,' }).coachAllowlist]).toEqual(['ak-andre'])
  })

  it('has nobody on the allowlist when it is unset', () => {
    expect(serverConfig({}).coachAllowlist.size).toBe(0)
  })

  // Undefined and not '' — `deriveUserId` treats a defined secret as "check
  // this header", and '' would compare against a header nobody sends.
  it('has no gateway secret unless one is set', () => {
    expect(serverConfig({}).gatewaySecret).toBeUndefined()
    expect(serverConfig({ VOICE_GATEWAY_SECRET: '' }).gatewaySecret).toBeUndefined()
    expect(serverConfig({ VOICE_GATEWAY_SECRET: 's3cret' }).gatewaySecret).toBe('s3cret')
  })
})

/**
 * `OLLAMA_HOST` defaults to `http://127.0.0.1:11434` — ollama's own default,
 * and the right one for the machine you are sitting at. Inside a container it
 * points at the container, where nothing is listening, and the only symptom is
 * a preload warning nobody reads until a drill dies on its first turn.
 */
describe('assertOllamaReachable', () => {
  const usesOllama = { mock: 'ollama', coding: 'cli' } as const
  const noOllama = { mock: 'cli', coding: 'cli' } as const

  it('refuses to start a deployed instance whose ollama is its own loopback', () => {
    expect(() => assertOllamaReachable({ VOICE_MODE: 'deployed' }, usesOllama)).toThrow(/OLLAMA_HOST/)
    expect(() => assertOllamaReachable({ VOICE_MODE: 'deployed', OLLAMA_HOST: 'localhost:11434' }, usesOllama)).toThrow(
      /OLLAMA_HOST/,
    )
    expect(() => assertOllamaReachable({ VOICE_MODE: 'deployed', OLLAMA_HOST: '[::1]:11434' }, usesOllama)).toThrow(
      /OLLAMA_HOST/,
    )
  })

  it('accepts a deployed instance pointed at something else', () => {
    expect(() =>
      assertOllamaReachable(
        { VOICE_MODE: 'deployed', OLLAMA_HOST: 'http://ollama-gateway.ollama-gateway.svc.cluster.local' },
        usesOllama,
      ),
    ).not.toThrow()
  })

  // A deployed instance on the claude transport never calls ollama, and must
  // not be made to configure a host it will not use.
  it('says nothing when no track is on ollama', () => {
    expect(() => assertOllamaReachable({ VOICE_MODE: 'deployed' }, noOllama)).not.toThrow()
  })

  // Loopback is the correct and overwhelmingly common local answer.
  it('leaves a local instance alone', () => {
    expect(() => assertOllamaReachable({}, usesOllama)).not.toThrow()
  })
})
