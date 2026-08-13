/**
 * @param libraries every library that must be initialized; names are unique.
 * @param dependencies pairs [x, y] meaning "x depends on y", so y must be
 *   initialized before x. Pairs may repeat.
 * @returns an ordering of all the libraries in which every library appears
 *   after everything it depends on, or null when no such ordering exists —
 *   because of a cycle, or because a pair names a library not in the list.
 */
export function initOrder(
  libraries: string[],
  dependencies: Array<[string, string]>,
): string[] | null {
  throw new Error('not implemented')
}
