import type { MenuItem } from './types'

export interface MenuRepository {
  findById(id: string): MenuItem | undefined
  list(): readonly MenuItem[]
  save(item: MenuItem): void
}

export class InMemoryMenuRepository implements MenuRepository {
  private readonly items = new Map<string, MenuItem>()

  findById(id: string): MenuItem | undefined {
    return this.items.get(id)
  }

  list(): readonly MenuItem[] {
    return [...this.items.values()]
  }

  save(item: MenuItem): void {
    this.items.set(item.id, item)
  }
}
