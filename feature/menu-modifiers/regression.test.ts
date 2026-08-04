import { beforeEach, describe, expect, it } from 'vitest'
import { NotFoundError, ValidationError } from './src/errors'
import { InMemoryMenuRepository } from './src/menu-repository'
import { MenuService } from './src/menu-service'

describe('InMemoryMenuRepository', () => {
  it('returns undefined for an id that was never saved', () => {
    const repo = new InMemoryMenuRepository()
    expect(repo.findById('nope')).toBeUndefined()
  })

  it('list is empty until items are saved', () => {
    const repo = new InMemoryMenuRepository()
    expect(repo.list()).toEqual([])
  })

  it('save overwrites an existing item with the same id', () => {
    const repo = new InMemoryMenuRepository()
    repo.save({ id: 'a', name: 'Fries', category: 'appetizer', priceCents: 500, available: true })
    repo.save({ id: 'a', name: 'Fries', category: 'appetizer', priceCents: 550, available: true })
    expect(repo.list()).toHaveLength(1)
    expect(repo.findById('a')?.priceCents).toBe(550)
  })
})

describe('MenuService.addItem', () => {
  let service: MenuService

  beforeEach(() => {
    service = new MenuService(new InMemoryMenuRepository())
  })

  it('creates an available item with the given fields', () => {
    const item = service.addItem({ name: 'Nachos', category: 'appetizer', priceCents: 900 })
    expect(item.name).toBe('Nachos')
    expect(item.category).toBe('appetizer')
    expect(item.priceCents).toBe(900)
    expect(item.available).toBe(true)
  })

  it('assigns unique, deterministic ids to successive items', () => {
    const first = service.addItem({ name: 'Nachos', category: 'appetizer', priceCents: 900 })
    const second = service.addItem({ name: 'Wings', category: 'appetizer', priceCents: 1100 })
    expect(first.id).not.toBe(second.id)
    expect(service.getItem(first.id)).toEqual(first)
    expect(service.getItem(second.id)).toEqual(second)
  })

  it('rejects an empty name', () => {
    expect(() =>
      service.addItem({ name: '  ', category: 'entree', priceCents: 1200 }),
    ).toThrow(ValidationError)
  })

  it('rejects a name over the length limit', () => {
    expect(() =>
      service.addItem({ name: 'x'.repeat(81), category: 'entree', priceCents: 1200 }),
    ).toThrow(ValidationError)
  })

  it('rejects a zero or negative price', () => {
    expect(() =>
      service.addItem({ name: 'Soup', category: 'appetizer', priceCents: 0 }),
    ).toThrow(ValidationError)
    expect(() =>
      service.addItem({ name: 'Soup', category: 'appetizer', priceCents: -100 }),
    ).toThrow(ValidationError)
  })

  it('rejects a non-integer price', () => {
    expect(() =>
      service.addItem({ name: 'Soup', category: 'appetizer', priceCents: 9.5 }),
    ).toThrow(ValidationError)
  })

  it('reports every validation issue at once, not just the first', () => {
    try {
      service.addItem({ name: '', category: 'appetizer', priceCents: -1 })
      expect.unreachable('expected addItem to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      const validationError = error as ValidationError
      expect(validationError.issues.length).toBeGreaterThanOrEqual(2)
      expect(validationError.issues.some((issue) => issue.includes('name'))).toBe(true)
      expect(validationError.issues.some((issue) => issue.includes('priceCents'))).toBe(true)
    }
  })

  it('carries the VALIDATION_FAILED code on the thrown error', () => {
    try {
      service.addItem({ name: '', category: 'appetizer', priceCents: 100 })
      expect.unreachable('expected addItem to throw')
    } catch (error) {
      expect((error as ValidationError).code).toBe('VALIDATION_FAILED')
    }
  })

  it('does not persist an item that fails validation', () => {
    expect(() =>
      service.addItem({ name: '', category: 'appetizer', priceCents: 100 }),
    ).toThrow()
    expect(service.listByCategory('appetizer')).toEqual([])
  })
})

describe('MenuService.getItem', () => {
  it('throws NotFoundError with the NOT_FOUND code for an unknown id', () => {
    const service = new MenuService(new InMemoryMenuRepository())
    expect(() => service.getItem('missing')).toThrow(NotFoundError)
    try {
      service.getItem('missing')
      expect.unreachable('expected getItem to throw')
    } catch (error) {
      expect((error as NotFoundError).code).toBe('NOT_FOUND')
    }
  })
})

describe('MenuService.listByCategory', () => {
  it('returns only items in the requested category', () => {
    const service = new MenuService(new InMemoryMenuRepository())
    service.addItem({ name: 'Nachos', category: 'appetizer', priceCents: 900 })
    service.addItem({ name: 'Burger', category: 'entree', priceCents: 1200 })
    service.addItem({ name: 'Wings', category: 'appetizer', priceCents: 1100 })

    const appetizers = service.listByCategory('appetizer')
    expect(appetizers.map((item) => item.name).sort()).toEqual(['Nachos', 'Wings'])
  })

  it('returns an empty list for a category with no items', () => {
    const service = new MenuService(new InMemoryMenuRepository())
    expect(service.listByCategory('dessert')).toEqual([])
  })
})

describe('MenuService.setAvailability', () => {
  it('flips availability while preserving other fields', () => {
    const service = new MenuService(new InMemoryMenuRepository())
    const item = service.addItem({ name: 'Nachos', category: 'appetizer', priceCents: 900 })

    const updated = service.setAvailability(item.id, false)

    expect(updated.available).toBe(false)
    expect(updated.id).toBe(item.id)
    expect(updated.name).toBe(item.name)
    expect(updated.category).toBe(item.category)
    expect(updated.priceCents).toBe(item.priceCents)
  })

  it('persists the change so a later getItem sees it', () => {
    const service = new MenuService(new InMemoryMenuRepository())
    const item = service.addItem({ name: 'Nachos', category: 'appetizer', priceCents: 900 })

    service.setAvailability(item.id, false)

    expect(service.getItem(item.id).available).toBe(false)
  })

  it('throws NotFoundError for an unknown id', () => {
    const service = new MenuService(new InMemoryMenuRepository())
    expect(() => service.setAvailability('missing', false)).toThrow(NotFoundError)
  })
})
