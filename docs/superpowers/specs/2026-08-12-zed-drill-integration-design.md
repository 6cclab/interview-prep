# Zed Drill Integration — Design

**Status:** approved for planning
**Date:** 2026-08-12

## Goal

Run drills inside Zed. Text drills happen entirely in the agent panel, with the
model acting as interviewer. Voice drills keep the browser microphone and gain a
Zed-side surface for tests, hints and verdict. Either way there is one session
and one hint counter.

## Why this is smaller than it looks

The web client never held the code. `voice/web` has no `textarea`, no
CodeMirror and no Monaco across its 19 components; `CodingTools` exposes only
`onRun` and `onHint`. Coding already happens in a real editor against real files
on disk, and Zed already runs vitest through its own task system.

What is actually missing from Zed is narrow: the hint ladder, the verdict, and
session state. That is the whole gap this design closes.

## Hard constraint: Zed extensions cannot do this

A Zed extension provides languages, debuggers, themes, icon themes, snippets and
MCP servers. Extensions compile to WebAssembly and have **no webview, no iframe,
no HTML panel and no custom UI surface** — nothing equivalent to VS Code's
`WebviewPanel`, and no microphone access.

Porting `voice/web` into an extension is therefore impossible, not merely hard.
The browser keeps the microphone permanently. MCP is the only extension point
that fits, which is why the whole design routes through it.

## Architecture

Three components, one of which is new.

```
  Zed agent panel                    Browser (voice only)
        │ stdio                            │ HTTP + SSE
        ▼                                  ▼
  mcp/server.ts  ──── localhost HTTP ──► voice/http-server.ts
  (stateless)                             (owns all session state)
```

### The MCP server holds no state

`mcp/server.ts` is a thin stdio client of the running HTTP server. Every tool
call becomes an HTTP call to `voice/http-server.ts`, which already owns session
state, the hint ladder, the vitest runner, the spoiler gate and the drill log.

The alternative — extracting a session core out of `http-server.ts` and having
both front ends call it — is rejected. That file is ~1670 lines and is the
component the daily loop depends on; extracting a core is a large refactor of
working software, and it creates a second copy of session state that then has to
be reconciled with the browser's. A thin client has one source of truth, needs
no refactor, and makes voice and text share a session automatically because only
one session ever exists.

The accepted cost: a drill in Zed requires the local server running. A
`drill:serve` script starts it without the browser tracks.

**No tool takes a session id.** The HTTP server tracks one current drill session
and every tool operates on it. This is what keeps the MCP server genuinely
stateless — holding a session id between calls would be state, and would let the
two front ends drift onto different sessions. One drill at a time is also how
the browser already behaves, so this adds no restriction.

## MCP tools

With `read_file` disabled in the drill profile (see below), the MCP server is the
*only* channel to repo content. It must therefore carry everything the
interviewer needs.

| Tool | Parameters | Returns |
|---|---|---|
| `drill_list` | `track?` | available drills for the track, or all |
| `drill_start` | `problem` | problem statement; opens a session |
| `drill_solution` | — | current `solution.ts` contents, read through `assertNoSpoilers` |
| `drill_run_tests` | — | vitest results for the open drill |
| `drill_hint` | — | exactly one rung — the next one |
| `drill_end` | `complexity` | verdict and drill-log entry |

`drill_hint` takes no rung parameter. The agent asks for *a* hint and the server
decides which one, incrementing its own counter. An agent cannot request rung 4.

`drill_end` requires `complexity` because the repo's existing rule is that time
and space complexity are asked for *before* the drill is confirmed done.

## The spoiler gate

A drill is destroyed the moment the answer enters context. Zed's agent has its
own filesystem tools, so it can read `solutions/**` or `patterns.md` on its own
initiative — a threat the current browser-only design never faced, because today
the model sees only what the server hands it.

Three layers:

1. **Zed drill profile.** Filesystem and shell tools off, only this context
   server enabled:

   ```json
   {
     "agent": {
       "profiles": {
         "drill": {
           "name": "Drill",
           "tools": {
             "read_file": false, "grep": false, "list_directory": false,
             "find_path": false, "terminal": false, "edit_file": false
           },
           "enable_all_context_servers": false,
           "context_servers": { "interview-prep": {} }
         }
       }
     }
   }
   ```

2. **`assertNoSpoilers`** (`voice/context.ts:32`) runs on every path the server
   reads. Existing code, reused unchanged.

3. **One rung per call**, counted server-side.

Layer 1 is a guardrail, not a sandbox: it is a user-selectable profile, and
switching profiles mid-thread removes it. **Layer 2 is the actual guarantee** —
the server will not serve a spoiler regardless of which profile is active. The
design leans on layer 2 and treats layer 1 as convenience.

This also means `drill_solution` exists for a reason: with `read_file` off, the
interviewer cannot see the candidate's code any other way.

## Voice mode: read-only tools

During a voice drill the browser already has an interviewer speaking. If the
agent panel also behaved like an interviewer there would be two of them, giving
different hints and disagreeing about the rung.

Therefore the server tracks a mode per session:

- **text mode** — the agent *is* the interviewer. All tools available.
- **voice mode** — the browser is the interviewer. The MCP tools are read-only
  helpers: `drill_run_tests`, `drill_solution`, and a `drill_status` view of the
  current rung and phase. `drill_start`, `drill_hint` and `drill_end` return an
  error naming the browser as the owner of the session.

`drill_status` is added for this mode; it is the only tool not in the table above
and exists solely so voice mode has a way to show state without advancing it.

## Error handling

- **Server not running.** Every tool returns a message naming `pnpm drill:serve`
  rather than a connection stack trace. This is the most common failure and the
  one most likely to be hit mid-drill.
- **No open session.** Tools other than `drill_list` and `drill_start` return an
  error saying so.
- **Spoiler path requested.** `assertNoSpoilers` throws; the MCP server surfaces
  the refusal verbatim rather than converting it to an empty result, so a
  refusal is never mistaken for an absent file.
- **Hint ladder exhausted.** `drill_hint` past rung 4 returns the rung-4 content
  again with a note, rather than erroring — the answer is already out.

## Testing

The MCP server is tested against a fake HTTP server, the same way
`voice/http-server.ts` already injects its transcoder and vitest runner so tests
never spawn real processes.

Coverage required:

- each tool's happy path
- server-unreachable produces the `drill:serve` message, not a stack trace
- `drill_hint` advances exactly one rung per call and never skips
- `drill_hint` cannot be made to return a specific rung by any parameter
- voice mode rejects `drill_start`, `drill_hint`, `drill_end`
- a spoiler path surfaces the refusal rather than an empty result

Tests live under `mcp/` and are picked up by adding `mcp/**/*.test.ts` to
`vitest.config.ts`'s `include`.

## Out of scope

- Extracting a session core from `voice/http-server.ts`.
- Any change to `voice/web`. The browser keeps the microphone and its UI.
- Voice output in Zed. The agent panel is text.
- Fixing the unhandled-exception crash at `voice/http-server.ts:1038`. Tracked
  separately and already being worked on; this design does not depend on it.

## Open question

`vitest.config.ts` deliberately has no `globalSetup`, because it runs for every
`vitest run` invocation including a single coding drill. Adding `mcp/**` to
`include` means a bare `pnpm test` also runs MCP tests. That is consistent with
how `voice/**` is already treated, so no change is proposed — but it is worth
confirming during planning that the MCP tests stay fast enough not to slow the
daily loop.
