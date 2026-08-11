# A browser editor for the coding track

**Date:** 2026-08-11
**Status:** approved design, not yet implemented
**Branch:** `browser-ide`

## Why, and why the existing rationale no longer settles it

`AGENTS.md` currently says:

> **There is no editor in the browser, deliberately.** You write the answer in
> your own editor, in the real `solution.ts`, against real types.

That reasoning optimises for learning a pattern. It never had to answer the
argument that motivates this work: **a real coding screen does not give you your
editor.** CoderPad, HackerRank and CodeSignal hand you a plain document with
syntax highlighting and nothing else — no type checking, no autocomplete, no
jump-to-definition. Drilling with a full IDE is rehearsing with an advantage you
will not have on the day.

Both claims are true, which is why this adds a **mode** rather than replacing
anything. The existing path remains correct for learning a pattern cold; the new
one is for rehearsing the interview.

Two other motivations were considered and explicitly rejected as drivers:
remote access (the homelab case) and zero-setup onboarding for a colleague. They
are real, and this work happens to serve them, but designing for them would
produce a different product — one where editing fidelity barely matters. Realism
is the requirement being designed to.

## Scope

In: `#/coding/<slug>`, one file (`solution.ts`), one editor.

Out: the debugging track. Its exercises are a directory of `src/` files plus two
suites, so it needs a file tree, tab management and multi-file save — a
materially bigger build with a different UI, and the realism argument is weakest
there, since no real interview hands you a repo to debug in a browser. Revisit
after this ships.

## The editor is deliberately limited

**CodeMirror 6**, configured for: syntax highlighting, line numbers, bracket
matching, standard indentation, undo/redo.

**Deliberately absent**, and this list is the feature rather than an omission:
the TypeScript language service, autocomplete, inline diagnostics,
go-to-definition, auto-import, snippets.

Monaco is rejected *because* it bundles the language service. Getting the
required experience out of Monaco means disabling its main feature, and a
future contributor would reasonably "fix" that.

### The dependency decision

This is the one place the project takes new runtime dependencies:
`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`,
`@codemirror/lang-javascript`.

The zero-dependency alternative — a monospace `<textarea>` — was considered and
rejected as *more* spartan than a real screen rather than equal to it. Real
screens do provide highlighting and line numbers; the goal is parity with them,
not asceticism for its own sake.

## Server surface

```
GET /api/coding/<slug>/solution  -> { text: string, version: string }
PUT /api/coding/<slug>/solution  -> 200 { version } | 409 | 404
```

Writes to `problems/<pattern>/<slug>/solution.ts` — the real file. That choice
is what makes three existing mechanisms keep working with no new machinery:
`Run tests` already runs `npx vitest` against that directory, `pnpm reset`
already archives that file to `local/attempts/`, and `/review` already debriefs
from it. A session-scoped temp copy would have required teaching all three about
temp copies.

### The pattern must not leak

**A coding problem's path is its pattern, and the pattern is the answer.** Both
routes take a bare slug. `voice/problems.ts` remains the only module that
resolves a slug to a directory. Neither request nor response body may contain
the resolved path, and `voice/coding-routes.test.ts` — which already asserts
this for every other coding route — gains the same assertions for these two.

### The clobber guard

`version` is a hash of the file's current content. `PUT` carries the version the
editor loaded, and the server returns **409** when it no longer matches.

Without this, a second tab or a save from your own editor silently destroys
work. 409 is the shape the codebase already uses for exactly this class of
problem: `POST /end` is non-re-entrant and returns 409 to a second caller,
because a lost race there produced two transcripts and a `00:00` elapsed time.

On 409 the client keeps the user's buffer, tells them the file changed
underneath, and offers to reload or overwrite. It must never discard typed text
to resolve a conflict.

### Saving

Autosave is debounced (~1s idle) and also fires on blur. **`Run tests` force-saves
first and waits for the save to land.** A verdict computed against stale text is
a verdict for code the candidate can see they did not write, and the verdict is
the single signal the drill produces.

## Mode selection and where it is recorded

The mode is chosen when the drill starts, on the problem picker.

**It is recorded in the transcript header, not in `local/drill-log.md`.** The
log's columns are parsed by two readers (`/status` and the `#/history` screen),
so adding one is a schema change with blast radius. The transcript header
already carries `Interviewer: cli / claude-sonnet-5` to answer the "what
produced this artifact" question days later; the editing mode is the same kind
of fact and belongs beside it.

## What deliberately does not change

- The hint ladder, its rungs, and the server-side rung count
- The three-way verdict — correctness-red, cost-red, errored — and the rule that
  collapsing the first two teaches the thing `drill.md` forbids
- The 45-minute clock and the time check fed to the interviewer
- `stripPatternPaths` on anything derived from test output
- `assertNoSpoilers` and the allowlist it guards
- `pnpm reset`'s archiving, which now covers browser attempts for free

## Testing

- **Route tests** in `voice/coding-routes.test.ts`: slug-only in and out; no
  resolved path in either payload; 409 on a stale version; 404 for an unknown
  slug; a slug that is not a plain slug is rejected by `PROBLEM_SLUG`.
- **A save-before-run test** proving the runner cannot see stale text — the one
  correctness property of the save path.
- **Editor component tests stay thin.** Asserting that CodeMirror renders is
  testing CodeMirror. Test the wiring: that a change marks the buffer dirty,
  that a 409 preserves the buffer.

## Costs, stated plainly

- **Two modes means two paths.** Every future change to the coding drill has to
  keep both working, and both need to appear in the docs.
- **`AGENTS.md:186` gets rewritten** from "there is no editor in the browser,
  deliberately" into a statement of when each mode is the right one. The
  paragraph's reasoning is preserved as the case for the your-own-editor mode
  rather than deleted.
- **The write-through model assumes one writer.** The 409 guard makes a
  collision loud rather than silent, but it does not make concurrent editing
  work, and it is not meant to.

## Follow-ups, not in this spec

- The debugging track's multi-file editor.
- Anything about deploying this to a homelab. The write-through model removes
  the editor/test-runner filesystem coupling that blocked it, which is a real
  consequence of this work, but the remaining blockers — the `127.0.0.1` bind
  and TLS for `getUserMedia` over a LAN — are untouched and unaddressed here.
