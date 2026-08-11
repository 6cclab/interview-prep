import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedLocal, setCandidateName } from './bootstrap'

let base: string
let templates: string
let dest: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'setup-test-'))
  templates = join(base, 'templates')
  dest = join(base, 'local')
  mkdirSync(templates, { recursive: true })
  writeFileSync(join(templates, 'config.yaml'), 'job_search_path: ~/job-search\n')
  writeFileSync(join(templates, 'drill-log.md'), '# Drill Log\n')
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('seedLocal', () => {
  it('creates the destination directory', () => {
    seedLocal(templates, dest)
    expect(readFileSync(join(dest, 'config.yaml'), 'utf8')).toContain('job_search_path')
  })

  it('copies every template file', () => {
    expect(seedLocal(templates, dest).sort()).toEqual(['config.yaml', 'drill-log.md'])
  })

  it('never overwrites an existing file', () => {
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'drill-log.md'), 'MY REAL LOG')
    seedLocal(templates, dest)
    expect(readFileSync(join(dest, 'drill-log.md'), 'utf8')).toBe('MY REAL LOG')
  })

  it('reports only the files it actually created', () => {
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'drill-log.md'), 'MY REAL LOG')
    expect(seedLocal(templates, dest)).toEqual(['config.yaml'])
  })

  it('is idempotent', () => {
    seedLocal(templates, dest)
    expect(seedLocal(templates, dest)).toEqual([])
  })
})

describe('setCandidateName', () => {
  it('sets the name in a freshly seeded config', () => {
    const freshDest = mkdtempSync(join(tmpdir(), 'bootstrap-'))
    seedLocal('templates/local', freshDest)
    expect(setCandidateName(freshDest, 'Dana')).toBe(true)
    expect(readFileSync(join(freshDest, 'config.yaml'), 'utf8')).toContain('candidate_name: Dana')
  })

  it('replaces an existing name rather than appending a second key', () => {
    const freshDest = mkdtempSync(join(tmpdir(), 'bootstrap-'))
    seedLocal('templates/local', freshDest)
    setCandidateName(freshDest, 'Dana')
    setCandidateName(freshDest, 'Sam')
    const body = readFileSync(join(freshDest, 'config.yaml'), 'utf8')
    expect(body).toContain('candidate_name: Sam')
    expect(body.match(/^candidate_name:/gm)).toHaveLength(1)
  })
})
