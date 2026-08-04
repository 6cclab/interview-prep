export class MenuError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'MenuError'
  }
}

export class NotFoundError extends MenuError {
  constructor(message: string) {
    super(message, 'NOT_FOUND')
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends MenuError {
  constructor(
    message: string,
    readonly issues: readonly string[],
  ) {
    super(message, 'VALIDATION_FAILED')
    this.name = 'ValidationError'
  }
}
