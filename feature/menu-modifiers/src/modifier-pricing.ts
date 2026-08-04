import type { MenuItem } from './types'

export type SelectionRule = 'exactly_one' | 'at_most_one' | 'any_number'

export interface ModifierOption {
  readonly id: string
  readonly name: string
  readonly priceDeltaCents: number
}

export interface ModifierGroup {
  readonly id: string
  readonly name: string
  readonly rule: SelectionRule
  readonly minSelections: number
  readonly maxSelections: number
  readonly options: readonly ModifierOption[]
}

export interface ModifierSelection {
  readonly groupId: string
  readonly optionIds: readonly string[]
}

export function priceOrderLine(
  item: MenuItem,
  groups: readonly ModifierGroup[],
  selections: readonly ModifierSelection[],
): number {
  throw new Error('not implemented')
}
