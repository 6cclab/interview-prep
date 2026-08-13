import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCandidateName, renderCandidate, DEFAULT_CANDIDATE } from './candidate'

function root(configBody?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'candidate-'))
  if (configBody !== undefined) {
    mkdirSync(join(dir, 'local'), { recursive: true })
    writeFileSync(join(dir, 'local/config.yaml'), configBody)
  }
  return dir
}

describe('readCandidateName', () => {
  it('reads the configured name', () => {
    expect(readCandidateName(root('candidate_name: Dana\n'), null)).toBe('Dana')
  })

  it('tolerates quotes and trailing comments, as the other yaml readers do', () => {
    expect(readCandidateName(root('candidate_name: "Dana Q"  # what she goes by\n'), null)).toBe('Dana Q')
  })

  // A missing local/ is the state a fresh clone is in, and a drill must still
  // run — bootstrap is a convenience, not a precondition.
  it('falls back when the file, the key or the value is absent', () => {
    expect(readCandidateName(root(), null)).toBe(DEFAULT_CANDIDATE)
    expect(readCandidateName(root('job_search_path: ~/job-search\n'), null)).toBe(DEFAULT_CANDIDATE)
    expect(readCandidateName(root('candidate_name:\n'), null)).toBe(DEFAULT_CANDIDATE)
    expect(readCandidateName(root('candidate_name: "   "\n'), null)).toBe(DEFAULT_CANDIDATE)
  })
})

describe('renderCandidate', () => {
  it('replaces every occurrence', () => {
    expect(renderCandidate('{{candidate}} said {{candidate}} was ready', 'Dana')).toBe(
      'Dana said Dana was ready',
    )
  })

  it('leaves text without the token untouched', () => {
    expect(renderCandidate('no token here', 'Dana')).toBe('no token here')
  })
})
