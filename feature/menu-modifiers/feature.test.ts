import { describe, expect, it } from 'vitest'
import { ValidationError } from './src/errors'
import type { ModifierGroup } from './src/modifier-pricing'
import { priceOrderLine } from './src/modifier-pricing'
import type { MenuItem } from './src/types'

const cheeseburger: MenuItem = {
  id: 'item-1',
  name: 'Cheeseburger',
  category: 'entree',
  priceCents: 900,
  available: true,
}

const bunGroup: ModifierGroup = {
  id: 'group-bun',
  name: 'Bun',
  rule: 'exactly_one',
  minSelections: 1,
  maxSelections: 1,
  options: [
    { id: 'opt-white', name: 'White Bun', priceDeltaCents: 0 },
    { id: 'opt-wheat', name: 'Wheat Bun', priceDeltaCents: 50 },
  ],
}

const toppingsGroup: ModifierGroup = {
  id: 'group-toppings',
  name: 'Toppings',
  rule: 'any_number',
  minSelections: 0,
  maxSelections: 3,
  options: [
    { id: 'opt-cheese', name: 'Extra Cheese', priceDeltaCents: 150 },
    { id: 'opt-bacon', name: 'Bacon', priceDeltaCents: 200 },
    { id: 'opt-avocado', name: 'Avocado', priceDeltaCents: 175 },
  ],
}

const spiceGroup: ModifierGroup = {
  id: 'group-spice',
  name: 'Spice Level',
  rule: 'at_most_one',
  minSelections: 0,
  maxSelections: 1,
  options: [
    { id: 'opt-mild', name: 'Mild', priceDeltaCents: 0 },
    { id: 'opt-hot', name: 'Hot', priceDeltaCents: 0 },
  ],
}

const requiredSauceGroup: ModifierGroup = {
  id: 'group-sauce',
  name: 'Sauce',
  rule: 'any_number',
  minSelections: 1,
  maxSelections: 2,
  options: [
    { id: 'opt-ketchup', name: 'Ketchup', priceDeltaCents: 0 },
    { id: 'opt-mayo', name: 'Mayo', priceDeltaCents: 0 },
    { id: 'opt-bbq', name: 'BBQ', priceDeltaCents: 100 },
  ],
}

function expectValidationError(fn: () => unknown): void {
  expect(fn).toThrow(ValidationError)
}

describe('priceOrderLine - exactly_one', () => {
  it('adds the chosen option delta to the base price', () => {
    const total = priceOrderLine(cheeseburger, [bunGroup], [
      { groupId: 'group-bun', optionIds: ['opt-wheat'] },
    ])
    expect(total).toBe(950)
  })

  it('supports a zero-delta option', () => {
    const total = priceOrderLine(cheeseburger, [bunGroup], [
      { groupId: 'group-bun', optionIds: ['opt-white'] },
    ])
    expect(total).toBe(900)
  })

  it('rejects zero selections for a required exactly_one group', () => {
    expectValidationError(() =>
      priceOrderLine(cheeseburger, [bunGroup], [{ groupId: 'group-bun', optionIds: [] }]),
    )
  })

  it('rejects a missing selection entry for a required exactly_one group', () => {
    expectValidationError(() => priceOrderLine(cheeseburger, [bunGroup], []))
  })

  it('rejects two selections for an exactly_one group', () => {
    expectValidationError(() =>
      priceOrderLine(cheeseburger, [bunGroup], [
        { groupId: 'group-bun', optionIds: ['opt-white', 'opt-wheat'] },
      ]),
    )
  })
})

describe('priceOrderLine - at_most_one', () => {
  it('allows zero selections and charges nothing extra', () => {
    const total = priceOrderLine(cheeseburger, [spiceGroup], [])
    expect(total).toBe(900)
  })

  it('allows exactly one selection', () => {
    const total = priceOrderLine(cheeseburger, [spiceGroup], [
      { groupId: 'group-spice', optionIds: ['opt-hot'] },
    ])
    expect(total).toBe(900)
  })

  it('rejects two selections', () => {
    expectValidationError(() =>
      priceOrderLine(cheeseburger, [spiceGroup], [
        { groupId: 'group-spice', optionIds: ['opt-mild', 'opt-hot'] },
      ]),
    )
  })
})

describe('priceOrderLine - any_number with explicit bounds', () => {
  it('sums the deltas of every selected option', () => {
    const total = priceOrderLine(cheeseburger, [toppingsGroup], [
      { groupId: 'group-toppings', optionIds: ['opt-bacon', 'opt-avocado'] },
    ])
    expect(total).toBe(900 + 200 + 175)
  })

  it('allows zero selections when minSelections is 0', () => {
    const total = priceOrderLine(cheeseburger, [toppingsGroup], [])
    expect(total).toBe(900)
  })

  it('allows exactly maxSelections options', () => {
    const total = priceOrderLine(cheeseburger, [toppingsGroup], [
      { groupId: 'group-toppings', optionIds: ['opt-cheese', 'opt-bacon', 'opt-avocado'] },
    ])
    expect(total).toBe(900 + 150 + 200 + 175)
  })

  it('rejects more than maxSelections options', () => {
    expectValidationError(() =>
      priceOrderLine(cheeseburger, [toppingsGroup], [
        {
          groupId: 'group-toppings',
          optionIds: ['opt-cheese', 'opt-bacon', 'opt-avocado', 'opt-cheese'],
        },
      ]),
    )
  })

  it('rejects fewer than minSelections when the group requires at least one', () => {
    expectValidationError(() => priceOrderLine(cheeseburger, [requiredSauceGroup], []))
  })

  it('rejects a missing entry for a required any_number group', () => {
    expectValidationError(() => priceOrderLine(cheeseburger, [requiredSauceGroup, bunGroup], [
      { groupId: 'group-bun', optionIds: ['opt-white'] },
    ]))
  })
})

describe('priceOrderLine - invalid references', () => {
  it('rejects an option id that does not belong to the group', () => {
    expectValidationError(() =>
      priceOrderLine(cheeseburger, [bunGroup], [
        { groupId: 'group-bun', optionIds: ['opt-does-not-exist'] },
      ]),
    )
  })

  it('rejects a group id that is not attached to the item', () => {
    expectValidationError(() =>
      priceOrderLine(cheeseburger, [bunGroup], [
        { groupId: 'group-does-not-exist', optionIds: ['opt-white'] },
      ]),
    )
  })

  it('rejects duplicate option ids within the same group selection', () => {
    expectValidationError(() =>
      priceOrderLine(cheeseburger, [toppingsGroup], [
        { groupId: 'group-toppings', optionIds: ['opt-bacon', 'opt-bacon'] },
      ]),
    )
  })

  it('collects multiple problems into a single ValidationError', () => {
    try {
      priceOrderLine(cheeseburger, [bunGroup, toppingsGroup], [
        { groupId: 'group-bun', optionIds: [] },
        { groupId: 'group-toppings', optionIds: ['opt-cheese', 'opt-cheese', 'opt-nope'] },
      ])
      expect.unreachable('expected priceOrderLine to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      const validationError = error as ValidationError
      expect(validationError.issues.length).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('priceOrderLine - combined groups', () => {
  it('matches the worked example from the ticket', () => {
    // Cheeseburger ($9.00) + wheat bun (+$0.50) + bacon (+$2.00) + avocado (+$1.75) = $13.25
    const total = priceOrderLine(cheeseburger, [bunGroup, toppingsGroup], [
      { groupId: 'group-bun', optionIds: ['opt-wheat'] },
      { groupId: 'group-toppings', optionIds: ['opt-bacon', 'opt-avocado'] },
    ])
    expect(total).toBe(1325)
  })

  it('handles a group with no options selected alongside a group that has selections', () => {
    const total = priceOrderLine(cheeseburger, [bunGroup, toppingsGroup, spiceGroup], [
      { groupId: 'group-bun', optionIds: ['opt-white'] },
      { groupId: 'group-toppings', optionIds: [] },
    ])
    expect(total).toBe(900)
  })
})
