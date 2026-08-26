/// <reference types="vite/client" />

/**
 * The TypeScript standard library, as `{ 'lib.es2022.d.ts': '…', … }`.
 *
 * Served by the `tsLibs` plugin in `vite.config.ts`, which resolves it out of
 * the installed `typescript` at build time. Only `src/assist/worker.ts` imports
 * it, and only the Practice editor loads that.
 */
declare module 'virtual:ts-libs' {
  const libs: Record<string, string>
  export default libs
}
