import type { NewMenuItemInput } from './types'
import { ValidationError } from './errors'

const MAX_NAME_LENGTH = 80

export function validateNewItem(input: NewMenuItemInput): void {
  const issues: string[] = []

  if (input.name.trim().length === 0) {
    issues.push('name must not be empty')
  }
  if (input.name.length > MAX_NAME_LENGTH) {
    issues.push(`name must be at most ${MAX_NAME_LENGTH} characters`)
  }
  if (!Number.isInteger(input.priceCents)) {
    issues.push('priceCents must be an integer')
  }
  if (input.priceCents <= 0) {
    issues.push('priceCents must be greater than zero')
  }

  if (issues.length > 0) {
    throw new ValidationError(`invalid menu item: ${issues.join('; ')}`, issues)
  }
}
