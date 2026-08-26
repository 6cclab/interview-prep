import libs from 'virtual:ts-libs'
import { createAssistService } from './service'
import type { AssistFromWorker, AssistResult, AssistToWorker } from './protocol'

/**
 * The assist Worker's shell: message plumbing and nothing else.
 *
 * Every decision lives in `service.ts`, which has no `node:*` and no DOM and is
 * therefore exercised directly by a Node test against the real standard
 * library. What is left here is a `switch` — small enough to read in one go,
 * which is the point, because it is the one part of this feature that no test
 * covers directly.
 *
 * `typescript` is imported by `service.ts`, so it lands in *this* chunk rather
 * than in the page. That is the whole reason for the Worker's existence besides
 * frame budget: 1.6MB gzipped downloads when Practice opens and never when a
 * drill does.
 */

const service = createAssistService(libs)

/**
 * `self`, typed as the Worker scope it actually is.
 *
 * `voice/web/tsconfig.json` sets `lib: ["ES2022", "DOM", "DOM.Iterable"]`,
 * under which `self` is a `Window` — so `postMessage` wants a target origin and
 * the message type is `any`. Adding `"WebWorker"` to that list is the textbook
 * fix and the wrong one here: it collides with `DOM` on several hundred shared
 * names, for one file. A local narrowing to the two members this uses says the
 * same thing and costs nothing elsewhere.
 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AssistToWorker>) => void) | null
  postMessage(message: AssistFromWorker): void
}

scope.onmessage = (event: MessageEvent<AssistToWorker>): void => {
  const message = event.data

  if (message.kind === 'update') {
    service.update(message.text)
    return
  }

  const reply = (response: AssistFromWorker): void => {
    scope.postMessage(response)
  }

  try {
    const { call } = message
    let result: AssistResult
    switch (call.name) {
      case 'diagnostics':
        result = service.diagnostics()
        break
      case 'completions':
        result = service.completions(call.position)
        break
      case 'completionDetail':
        result = service.completionDetail(call.position, call.label)
        break
      case 'quickInfo':
        result = service.quickInfo(call.position)
        break
    }
    reply({ kind: 'ok', id: message.id, result })
  } catch (error) {
    // A language service can throw on a buffer that is mid-keystroke — an
    // unterminated template literal is the usual one. Reported rather than
    // rethrown: an unhandled throw in a Worker takes the Worker with it, and
    // the editor would lose its checker for the rest of the session over one
    // transient state that the next keystroke fixes.
    reply({
      kind: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
