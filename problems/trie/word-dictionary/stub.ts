export class WordDictionary {
  /**
   * @param word lowercase a-z only, 1-25 characters.
   */
  addWord(word: string): void {
    throw new Error('not implemented')
  }

  /**
   * @param word lowercase a-z or '.', 1-25 characters. '.' matches any
   *   single character.
   * @returns whether some previously added word matches.
   */
  search(word: string): boolean {
    throw new Error('not implemented')
  }
}
