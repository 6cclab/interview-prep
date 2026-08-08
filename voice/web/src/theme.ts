import { useEffect, useState } from 'react'

/**
 * Brutalkit's theme families are scoped by `[data-theme="..."]` (set once,
 * statically, on `<html>` in index.html) with a `.dark` class flipping each
 * token to its dark value — see `brutalkit/themes/sage`. This hook owns only
 * the light/dark toggle; the family itself is fixed to `sage` per the
 * handoff's default.
 */
export function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true,
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  return [dark, () => setDark((d) => !d)]
}
