import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedLocal } from './bootstrap'

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
