import type { MenuRepository } from './menu-repository'
import type { Category, MenuItem, NewMenuItemInput } from './types'
import { NotFoundError } from './errors'
import { validateNewItem } from './validation'

export class MenuService {
  private nextId = 1

  constructor(private readonly repository: MenuRepository) {}

  getItem(id: string): MenuItem {
    const item = this.repository.findById(id)
    if (!item) {
      throw new NotFoundError(`menu item not found: ${id}`)
    }
    return item
  }

  listByCategory(category: Category): readonly MenuItem[] {
    return this.repository.list().filter((item) => item.category === category)
  }

  addItem(input: NewMenuItemInput): MenuItem {
    validateNewItem(input)
    const item: MenuItem = {
      id: `item-${this.nextId++}`,
      name: input.name,
      category: input.category,
      priceCents: input.priceCents,
      available: true,
    }
    this.repository.save(item)
    return item
  }

  setAvailability(id: string, available: boolean): MenuItem {
    const item = this.getItem(id)
    const updated: MenuItem = { ...item, available }
    this.repository.save(updated)
    return updated
  }
}
