import {
  autocompletion,
  completionStatus,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { linter, type Diagnostic } from '@codemirror/lint'
import { EditorView, hoverTooltip } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { AssistClient } from './client'
import type { AssistDiagnostic } from './service'

/**
 * The CodeMirror side of the assist: three extensions over one `AssistClient`.
 *
 * **Practice only.** See `service.ts` for why that boundary exists and
 * `assist-is-practice-only.test.ts` for what enforces it. Nothing in this file
 * may be reached from the drill editor.
 *
 * This module imports `@codemirror/lint` and `@codemirror/autocomplete`, which
 * `SolutionEditor.tsx` is forbidden to import and still does not. That is the
 * shape of the rule now: the capability exists in the tree, one screen composes
 * it in, and the editor component itself stays a plain document that gains
 * whatever its caller hands it.
 */

/** How long the buffer must be still before the checker runs. */
const LINT_DELAY_MS = 400

/**
 * A pending request can outlive the document it was asked about — the candidate
 * keeps typing while the service is checking — and a span past the end of the
 * current document makes CodeMirror throw rather than skip. Clamping is not
 * paranoia here; it is the normal case at typing speed.
 */
function clamp(diagnostic: AssistDiagnostic, length: number): Diagnostic | null {
  const from = Math.min(diagnostic.from, length)
  const to = Math.min(Math.max(diagnostic.to, from), length)
  if (from >= length && to >= length && from === to) return null
  return { from, to, severity: diagnostic.severity, message: diagnostic.message }
}

/**
 * A tooltip body, built with the DOM rather than `innerHTML`.
 *
 * The strings here come from the TypeScript service reading the candidate's own
 * buffer, so a `<script>` in a doc comment is *their* text — but it is text that
 * has made a round trip through a Worker, and building nodes costs one line
 * more than not doing.
 */
function tooltipBody(signature: string, documentation: string): HTMLElement {
  const host = document.createElement('div')
  host.className = 'assist-tooltip'
  const code = document.createElement('code')
  code.className = 'assist-tooltip__signature'
  code.textContent = signature
  host.append(code)
  if (documentation !== '') {
    const prose = document.createElement('p')
    prose.className = 'assist-tooltip__doc'
    prose.textContent = documentation
    host.append(prose)
  }
  return host
}

/**
 * Diagnostics, on a debounce.
 *
 * `client.update` is called here rather than only from the update listener so
 * the service is never asked about a document it has not been shown. The two
 * paths are cheap and idempotent — `update` returns immediately when the text
 * is unchanged — and relying on the listener alone means an ordering bug the
 * day someone adds a second way to change the document.
 */
function diagnostics(client: AssistClient): Extension {
  return linter(
    async (view) => {
      const text = view.state.doc.toString()
      client.update(text)
      try {
        const found = await client.diagnostics()
        const length = view.state.doc.length
        return found.flatMap((d) => {
          const mapped = clamp(d, length)
          return mapped === null ? [] : [mapped]
        })
      } catch {
        // The Worker was disposed, or the service threw on a mid-keystroke
        // buffer. Either way: no squiggles this pass, and the next keystroke
        // tries again. Reporting nothing is right — reporting a stale list
        // would leave an underline under text that no longer says that.
        return []
      }
    },
    { delay: LINT_DELAY_MS },
  )
}

function completions(client: AssistClient): Extension {
  const source = async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/[\w$]*/)
    const afterDot = context.matchBefore(/\.[\w$]*$/) !== null
    // Without this the list opens on every keystroke including whitespace,
    // which is the behaviour that makes people turn autocomplete off. A member
    // access is the one place it is wanted unprompted; everywhere else it waits
    // for a word to have started, or for Ctrl-Space.
    if (!context.explicit && !afterDot && (word === null || word.from === word.to)) return null

    client.update(context.state.doc.toString())
    let entries
    try {
      entries = await client.completions(context.pos)
    } catch {
      return null
    }
    if (entries.length === 0) return null

    const options: Completion[] = entries.map((entry) => ({
      label: entry.label,
      type: entry.type,
      // TypeScript has already ranked these — locals above globals, own
      // members above inherited ones. Re-sorting alphabetically, which is what
      // CodeMirror does by default, throws away the only ordering here that
      // knows anything about the code.
      boost: 0,
      info: async (): Promise<HTMLElement | null> => {
        try {
          const detail = await client.completionDetail(context.pos, entry.label)
          return detail === null ? null : tooltipBody(detail.signature, detail.documentation)
        } catch {
          return null
        }
      },
    }))

    return {
      from: word?.from ?? context.pos,
      options,
      // The list survives further word characters being typed, filtered
      // locally, instead of a fresh round trip to the Worker per keystroke.
      validFor: /^[\w$]*$/,
    }
  }

  return autocompletion({ override: [source], activateOnTyping: true, icons: true })
}

function hover(client: AssistClient): Extension {
  return hoverTooltip(async (view, position) => {
    // Not while the completion list is open. Both are tooltips, both are
    // anchored near the cursor, and CodeMirror will happily show them
    // overlapping — which it did on the first run of this in a browser: a
    // `this.` completion list with a bare `any` hover card sitting on top of
    // the detail panel that was already answering the same question better.
    if (completionStatus(view.state) !== null) return null
    client.update(view.state.doc.toString())
    let info
    try {
      info = await client.quickInfo(position)
    } catch {
      return null
    }
    if (info === null || info.signature === '') return null
    return {
      pos: Math.min(info.from, view.state.doc.length),
      end: Math.min(info.to, view.state.doc.length),
      create: () => ({ dom: tooltipBody(info.signature, info.documentation) }),
    }
  })
}

/**
 * Everything the assist adds, as one extension for a caller to append.
 *
 * Ordered with the update listener first so the service has seen a change
 * before either of the other two can ask about it.
 */
export function assistExtensions(client: AssistClient): Extension[] {
  return [
    EditorView.updateListener.of((update) => {
      if (update.docChanged) client.update(update.state.doc.toString())
    }),
    diagnostics(client),
    completions(client),
    hover(client),
  ]
}
