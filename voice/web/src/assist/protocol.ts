import type {
  AssistCompletion,
  AssistCompletionDetail,
  AssistDiagnostic,
  AssistQuickInfo,
} from './service'

/**
 * What crosses the boundary between the editor and the assist Worker.
 *
 * The Worker exists for one reason: a language service parses 45 lib files on
 * its first question and re-checks the buffer on every keystroke after that,
 * and doing either on the main thread is a dropped frame in the editor the
 * candidate is typing into. Everything here is therefore plain data — no
 * functions, no class instances — because that is all `postMessage` can carry.
 *
 * Unlike the test runner's Worker, this one is **long-lived**. That runner
 * terminates on every settle path because a fresh one is the only reliable way
 * to stop a candidate's infinite loop. Nothing here runs candidate code — the
 * service only ever reads it — so there is nothing to contain, and keeping it
 * alive is what makes the second keystroke fast.
 */

/** Fire-and-forget: the buffer changed. Ordered before any request that follows it. */
export interface AssistUpdate {
  kind: 'update'
  text: string
}

export interface AssistRequest {
  kind: 'request'
  id: number
  call:
    | { name: 'diagnostics' }
    | { name: 'completions'; position: number }
    | { name: 'completionDetail'; position: number; label: string }
    | { name: 'quickInfo'; position: number }
}

export type AssistToWorker = AssistUpdate | AssistRequest

/**
 * One answer.
 *
 * `error` is a case rather than a rejection channel because a language service
 * throwing is a real possibility on a half-typed file, and a Worker that dies
 * silently leaves every pending request hanging forever. Naming the failure
 * means the editor can drop the squiggles and carry on rather than freeze
 * mid-keystroke.
 */
export type AssistFromWorker =
  | { kind: 'ok'; id: number; result: AssistResult }
  | { kind: 'error'; id: number; message: string }

export type AssistResult =
  | AssistDiagnostic[]
  | AssistCompletion[]
  | AssistCompletionDetail
  | AssistQuickInfo
  | null
