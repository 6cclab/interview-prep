export type Category = 'appetizer' | 'entree' | 'dessert' | 'beverage'

export interface MenuItem {
  readonly id: string
  readonly name: string
  readonly category: Category
  readonly priceCents: number
  readonly available: boolean
}

export interface NewMenuItemInput {
  readonly name: string
  readonly category: Category
  readonly priceCents: number
}
