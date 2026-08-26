import ts from 'typescript'

/**
 * A TypeScript language service over one in-memory file.
 *
 * This exists because of a specific afternoon. A buffer read
 * `this.map.keys()` where the field was named `store`; `this.map` was
 * `undefined`, `put` threw a `TypeError` on its first line, and all ten tests
 * in the suite went red. The runner was right and said so — but "ten tests
 * failed" and "you typed the wrong field name" are the same picture from the
 * outside, and the hour that went into telling them apart went into the wrong
 * place entirely. `tsc` had the answer the whole time and nothing was asking
 * it.
 *
 * ---
 *
 * **Practice only.** `SolutionEditor`'s doc comment states the rule this file
 * sits next to: a drill editor has no language service, no autocomplete and no
 * inline diagnostics, because a real coding screen has none and drilling with
 * one rehearses an advantage that will not be there on the day. That rule is
 * unchanged and still enforced — see `SolutionEditor.test.tsx`, which fails on
 * a forbidden import, and `assist-is-practice-only.test.ts`, which fails if the
 * drill's editor is ever handed these extensions.
 *
 * Practice is a different screen with a different purpose. It is untimed,
 * unrecorded, has a tutor sitting beside it, and its own header says so. It is
 * where you go to *learn* the shape of a problem, not to rehearse an interview.
 * An IDE belongs there for the same reason it does not belong in a drill.
 *
 * ---
 *
 * **No `node:*` and no DOM.** This module runs inside a Worker, and it is also
 * exercised directly by a Node test. Everything environment-specific — reading
 * the lib files off disk, the `postMessage` plumbing — lives in the callers.
 */

/** The candidate's buffer, under the name the suite imports it by. */
export const SOLUTION_FILE = '/solution.ts'

/** Ambient declarations, kept deliberately tiny. See `AMBIENT`. */
export const GLOBALS_FILE = '/globals.d.ts'

/**
 * The default lib, and the one this service type-checks against.
 *
 * ES2022 rather than a newer or older target because that is what the repo's
 * own `tsconfig.json` sets. The editor agreeing with `pnpm typecheck` is the
 * whole value of it: an editor that flags what the build accepts, or accepts
 * what the build flags, is worse than no editor, because it teaches you to
 * ignore it.
 */
export const DEFAULT_LIB = 'lib.es2022.d.ts'

/**
 * `console` and `performance`, declared by hand instead of by shipping the DOM.
 *
 * Both are genuinely reachable from a solution: `console.log` is a supported
 * debugging route (the runner captures it — see `RunLog`), and a scale test
 * measures with `performance.now()`, so a candidate reasonably reaches for it.
 * Neither is in `lib.es2022.d.ts`, which describes the language and not a host.
 *
 * The alternative was `lib.dom.d.ts`. It was rejected twice over: it is larger
 * than every ES lib file put together, and it would put `document`, `window`,
 * `HTMLElement` and several thousand other names into a completion list for a
 * file that runs in a Worker and touches none of them. A completion list is
 * only useful in proportion to how much of it is plausible.
 *
 * Narrow on purpose, therefore, and narrow in the direction of under-declaring:
 * a missing name shows up as one red squiggle on a line the candidate wrote,
 * which is a small and legible cost. Over-declaring shows up as an editor that
 * accepts code the runner will not.
 */
export const AMBIENT = `
declare var console: {
  log(...data: unknown[]): void
  info(...data: unknown[]): void
  warn(...data: unknown[]): void
  error(...data: unknown[]): void
  debug(...data: unknown[]): void
}
declare var performance: { now(): number }
`

export interface AssistDiagnostic {
  /** Character offsets into the buffer, which is what CodeMirror's linter wants. */
  from: number
  to: number
  message: string
  severity: 'error' | 'warning'
}

export interface AssistCompletion {
  label: string
  /** CodeMirror's completion `type`, for the icon. */
  type: string
  /** Sort key from TypeScript, so its ordering survives the trip. */
  sortText: string
}

/** A completion plus what TypeScript knows about it — fetched only when one is highlighted. */
export interface AssistCompletionDetail {
  label: string
  signature: string
  documentation: string
}

export interface AssistQuickInfo {
  from: number
  to: number
  signature: string
  documentation: string
}

export interface AssistService {
  /** Replace the buffer. Cheap: it bumps a version and lets the service re-parse lazily. */
  update(text: string): void
  diagnostics(): AssistDiagnostic[]
  completions(position: number): AssistCompletion[]
  completionDetail(position: number, label: string): AssistCompletionDetail | null
  quickInfo(position: number): AssistQuickInfo | null
}

/**
 * TypeScript's completion kinds mapped onto CodeMirror's, which is a much
 * smaller set. Anything unlisted falls through to `variable` rather than being
 * dropped: a completion with a plain icon is useful, and a missing completion
 * is the failure this whole file exists to prevent.
 */
function completionType(kind: ts.ScriptElementKind): string {
  switch (kind) {
    case ts.ScriptElementKind.memberFunctionElement:
    case ts.ScriptElementKind.functionElement:
    case ts.ScriptElementKind.localFunctionElement:
      return 'function'
    case ts.ScriptElementKind.memberVariableElement:
    case ts.ScriptElementKind.memberGetAccessorElement:
    case ts.ScriptElementKind.memberSetAccessorElement:
      return 'property'
    case ts.ScriptElementKind.classElement:
      return 'class'
    case ts.ScriptElementKind.interfaceElement:
    case ts.ScriptElementKind.typeElement:
    case ts.ScriptElementKind.typeParameterElement:
      return 'type'
    case ts.ScriptElementKind.enumElement:
      return 'enum'
    case ts.ScriptElementKind.enumMemberElement:
      return 'constant'
    case ts.ScriptElementKind.keyword:
      return 'keyword'
    default:
      return 'variable'
  }
}

/**
 * Mirrors `tsconfig.json` at the repo root.
 *
 * `noEmit` because nothing here compiles — `execute.ts` does that with sucrase,
 * from the raw buffer, and always will. This service only ever answers
 * questions.
 */
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  lib: [DEFAULT_LIB],
  strict: true,
  noUncheckedIndexedAccess: true,
  noEmit: true,
  skipLibCheck: true,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  // The buffer is a module (it `export`s a class or a function) even before the
  // candidate has typed the `export`. Without this, a half-written file is
  // briefly a script, every declaration in it is briefly a global, and the
  // diagnostics flicker between two readings of the same text as you type.
  moduleDetection: ts.ModuleDetectionKind.Force,
}

/**
 * @param libs the `lib.*.d.ts` sources, keyed by bare filename. The caller
 *   supplies them because where they come from is environment-specific: the
 *   Worker gets them from a Vite virtual module, the Node test reads
 *   `node_modules` directly. Passing them in is what keeps this file free of
 *   both.
 * @param initial the buffer's starting contents.
 */
export function createAssistService(libs: Record<string, string>, initial = ''): AssistService {
  let text = initial
  let version = 0

  const files = new Map<string, string>([[GLOBALS_FILE, AMBIENT]])

  const read = (fileName: string): string | undefined => {
    if (fileName === SOLUTION_FILE) return text
    const own = files.get(fileName)
    if (own !== undefined) return own
    // Lib files are asked for by several spellings depending on which code path
    // inside TypeScript is doing the asking — bare, `/`-prefixed, and with a
    // `/lib/` directory in front. Normalising to the basename here is what lets
    // the caller hand over a flat `{ 'lib.es5.d.ts': '…' }` map and be done.
    return libs[fileName.slice(fileName.lastIndexOf('/') + 1)]
  }

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [GLOBALS_FILE, SOLUTION_FILE],
    // Only the buffer changes, so only the buffer needs a moving version. A
    // constant for everything else means the service never re-reads a lib file
    // it has already parsed — which is most of the cost of a keystroke here.
    getScriptVersion: (fileName) => (fileName === SOLUTION_FILE ? String(version) : '0'),
    getScriptSnapshot: (fileName) => {
      const source = read(fileName)
      return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source)
    },
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => OPTIONS,
    getDefaultLibFileName: () => `/${DEFAULT_LIB}`,
    fileExists: (fileName) => read(fileName) !== undefined,
    readFile: read,
    // Directories never come up: there is one flat namespace and no resolution
    // to do. Answering honestly rather than throwing keeps the service from
    // taking a diagnostics call down with it if a future option starts asking.
    directoryExists: () => false,
    getDirectories: () => [],
  }

  const service = ts.createLanguageService(host, ts.createDocumentRegistry())

  const flatten = (message: string | ts.DiagnosticMessageChain): string =>
    ts.flattenDiagnosticMessageText(message, ' ')

  return {
    update(next: string): void {
      if (next === text) return
      text = next
      version += 1
    },

    diagnostics(): AssistDiagnostic[] {
      // Syntactic first and semantic second, deliberately in that order and
      // both included. A file that does not parse produces a cascade of
      // meaningless semantic errors on top of the one real syntax error, and
      // showing the syntax error first is what makes the list readable.
      const all = [
        ...service.getSyntacticDiagnostics(SOLUTION_FILE),
        ...service.getSemanticDiagnostics(SOLUTION_FILE),
      ]
      return all.flatMap((diagnostic) => {
        // A diagnostic without a position belongs to the program rather than to
        // a span of text, and there is nowhere in the document to hang it.
        if (diagnostic.start === undefined) return []
        return [
          {
            from: diagnostic.start,
            to: diagnostic.start + (diagnostic.length ?? 0),
            message: flatten(diagnostic.messageText),
            severity:
              diagnostic.category === ts.DiagnosticCategory.Warning
                ? ('warning' as const)
                : ('error' as const),
          },
        ]
      })
    },

    completions(position: number): AssistCompletion[] {
      const result = service.getCompletionsAtPosition(SOLUTION_FILE, position, {
        includeCompletionsForModuleExports: false,
        includeCompletionsWithInsertText: false,
      })
      if (result === undefined) return []
      return result.entries.map((entry) => ({
        label: entry.name,
        type: completionType(entry.kind),
        sortText: entry.sortText,
      }))
    },

    /**
     * The signature and doc comment for one entry.
     *
     * Separate from `completions` because it is separate in TypeScript too, and
     * for a good reason: resolving details for every entry in a list that can
     * run to hundreds means type-checking hundreds of declarations to render
     * something the candidate will read one of.
     */
    completionDetail(position: number, label: string): AssistCompletionDetail | null {
      const details = service.getCompletionEntryDetails(
        SOLUTION_FILE,
        position,
        label,
        undefined,
        undefined,
        undefined,
        undefined,
      )
      if (details === undefined) return null
      return {
        label,
        signature: ts.displayPartsToString(details.displayParts),
        documentation: ts.displayPartsToString(details.documentation),
      }
    },

    quickInfo(position: number): AssistQuickInfo | null {
      const info = service.getQuickInfoAtPosition(SOLUTION_FILE, position)
      if (info === undefined) return null
      return {
        from: info.textSpan.start,
        to: info.textSpan.start + info.textSpan.length,
        signature: ts.displayPartsToString(info.displayParts),
        documentation: ts.displayPartsToString(info.documentation),
      }
    },
  }
}
