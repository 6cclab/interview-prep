import type { AssistFromWorker, AssistToWorker } from './protocol'
import type {
  AssistCompletion,
  AssistCompletionDetail,
  AssistDiagnostic,
  AssistQuickInfo,
} from './service'

/**
 * The main-thread half of the assist Worker: request ids in, promises out.
 *
 * Split from `extension.ts` for the same reason `clientVerdict.ts` is split
 * from `worker.ts` in the test runner — everything that decides an outcome
 * should be reachable without spawning a real Worker. `spawn` is a parameter,
 * so a test can hand over a fake port and assert on the wire.
 */

/** The slice of `Worker` this uses. Narrow, so a test double is three methods. */
export interface AssistWorker {
  postMessage(message: AssistToWorker): void
  terminate(): void
  onmessage: ((event: MessageEvent<AssistFromWorker>) => void) | null
}

export interface AssistClient {
  /** The buffer changed. Ordered before any request made after it. */
  update(text: string): void
  diagnostics(): Promise<AssistDiagnostic[]>
  completions(position: number): Promise<AssistCompletion[]>
  completionDetail(position: number, label: string): Promise<AssistCompletionDetail | null>
  quickInfo(position: number): Promise<AssistQuickInfo | null>
  dispose(): void
}

/**
 * The default Worker, built the way Vite wants so the entry becomes its own
 * chunk rather than being inlined into the page.
 */
function spawnWorker(): AssistWorker {
  return new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as AssistWorker
}

export function createAssistClient(spawn: () => AssistWorker = spawnWorker): AssistClient {
  const worker = spawn()
  const pending = new Map<number, { resolve(value: never): void; reject(error: Error): void }>()
  let nextId = 0
  let disposed = false

  worker.onmessage = (event): void => {
    const message = event.data
    const waiting = pending.get(message.id)
    if (waiting === undefined) return
    pending.delete(message.id)
    if (message.kind === 'ok') waiting.resolve(message.result as never)
    else waiting.reject(new Error(message.message))
  }

  const request = <T,>(call: Extract<AssistToWorker, { kind: 'request' }>['call']): Promise<T> => {
    // A request made after `dispose` would never be answered — the Worker is
    // gone — and an editor that is being torn down mid-keystroke is exactly
    // when that happens. Rejecting is what lets the caller's `catch` drop the
    // result instead of leaving a promise pending for the life of the page.
    if (disposed) return Promise.reject(new Error('the assist worker has been disposed'))
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: never) => void, reject })
      worker.postMessage({ kind: 'request', id, call })
    })
  }

  return {
    update(text: string): void {
      if (disposed) return
      worker.postMessage({ kind: 'update', text })
    },
    diagnostics: () => request<AssistDiagnostic[]>({ name: 'diagnostics' }),
    completions: (position) => request<AssistCompletion[]>({ name: 'completions', position }),
    completionDetail: (position, label) =>
      request<AssistCompletionDetail | null>({ name: 'completionDetail', position, label }),
    quickInfo: (position) => request<AssistQuickInfo | null>({ name: 'quickInfo', position }),
    dispose(): void {
      if (disposed) return
      disposed = true
      worker.terminate()
      for (const waiting of pending.values()) {
        waiting.reject(new Error('the assist worker has been disposed'))
      }
      pending.clear()
    },
  }
}
