export interface SessionState {
  accountId: string
  userId: string
}

export class Session {
  private state: SessionState

  constructor(initial: SessionState) {
    this.state = initial
  }

  get accountId(): string {
    return this.state.accountId
  }

  get userId(): string {
    return this.state.userId
  }

  switchAccount(accountId: string): void {
    this.state = { ...this.state, accountId }
  }
}
