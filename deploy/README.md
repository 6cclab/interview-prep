# Deploying an instance

A deployed instance is a **different mode**, not a local one with the lock off.
Local instances are untouched by everything here: `VOICE_MODE` defaults to
`local`, and `userDataDir(root, null)` returns `local/` byte-for-byte.

## What deployed mode changes

| | local | deployed |
|---|---|---|
| Identity | none, headers never read | none — Authentik guards the door, the app does not ask |
| State | `local/` | `local/` — one instance, one person |
| Sessions | one, globally | one, globally |
| Tests | vitest, server-side | in the browser, verdict posted back |
| Coach track | open — it is your own choice | open — still your own instance |
| TTS | speaks on this machine | see "Voice", below |

## One instance, one person

The app does not ask who is calling. Authentik decides who may reach an
instance; two people means two instances, each with its own volume. Isolation is
one process each rather than identity handling inside one process — at this
scale that is less code and less to get wrong, and the failure mode of a mistake
is "my drill log is empty", not "I am reading yours".

The per-user machinery is still here and still tested — `voice/identity.ts`,
`voice/user-root.ts`, the coach allowlist, the gateway secret,
`scripts/migrate-local-to-user.ts`. `VOICE_MULTI_USER=1` turns all of it back on
at once, and then this needs `VOICE_COACH_ALLOWLIST`, `VOICE_GATEWAY_SECRET`,
the two Traefik middlewares in `k8s.yaml`, and a run of:

```bash
pnpm tsx scripts/migrate-local-to-user.ts <your-authentik-uid>
```

It refuses to switch on for a *local* instance, which is already yours —
turning it on there would move an existing drill log into a subdirectory
silently.

## Running it on your own machine

**For an ordinary drill, none of this applies.** `pnpm mock:web` is unchanged:
`VOICE_MODE` defaults to `local`, no headers are read, and the container is not
involved. Reach for the image only when the thing you want to test *is* the
deployed build.

Then it is one container on one port with nothing to sign in as:

```bash
export OLLAMA_HOST=https://ollama-gateway.apps.dev-01.6cclab.dev
export OLLAMA_API_KEY=$(security find-internet-password \
  -s ollama-gateway.apps.dev-01.6cclab.dev -w)   # the key Zed already uses

pnpm deploy:image     # build, once
pnpm deploy:local     # prints one URL — open that
```

`deploy:local` cleans up on Ctrl-C, and prints the container's own last words
if it refuses to start — a bad `OLLAMA_HOST` says so itself, and that message is
worth more than a refused connection.

Note `VOICE_MODE=local` on the container still does not work: local mode runs
`checkSpeechEngine()`, there is no piper in the image, and it binds loopback
inside its own namespace. It exits immediately, correctly. The image is a
deployed-mode image; `pnpm mock:web` is the local one.

`models/` is bind-mounted at `/opt/whisper/models`, so a spoken turn works.
`whisper-cli` itself is built into the image rather than mounted — it was a
PVC, which is fine in the cluster and made the image useless on a laptop, since
a macOS `whisper-cli` cannot be bind-mounted into a linux container. `models/`
is untracked, so a **git worktree has an empty one**: symlink the main
checkout's copy, or spoken turns will not work and the run will say so.

## Configuration

Everything the container needs, and what happens when it is missing.

| Variable | From | Missing means |
|---|---|---|
| `VOICE_MODE` | Dockerfile | `local` — no identity check at all. An unrecognised value refuses to start rather than falling back. |
| `VOICE_BACKEND` | manifest | refuses to start; a transport you did not choose is one you discover mid-drill |
| `OLLAMA_HOST` | ConfigMap | refuses to start in deployed mode, because ollama's own default is loopback and a container's loopback is itself |
| `OLLAMA_API_KEY` | Infisical | **silent** — absent means unauthenticated by design, so the gateway 401s on the first turn |
| `VOICE_MULTI_USER` | unset | one instance, one person — the default, and what the rest of this file assumes |

`OLLAMA_API_KEY` is the one with no boot-time signal. It is deliberate —
pointing `OLLAMA_HOST` at a bare ollama box must keep working, so absent has to
mean unauthenticated rather than an error (`voice/ollama.ts`, `ollamaHeaders`).
It lives in Infisical, provisioned by the `HomelabSecret` in `k8s.yaml` the same
way every other service in the cluster gets its credentials. **The Infisical
project does not exist yet** — create it, put its UUID in the `projectId` field,
and add the key before applying.

## Voice: not finished, and the reason

`voice/speech.ts` spawns `say` or `piper | ffplay` **on the machine the server
runs on**. The client has no audio playback code at all. Deployed as-is, every
user's interviewer would speak from the server's own audio device.

The interim fix is for the client to speak via the browser's `speechSynthesis`,
and for `/api/devices/*` to stop being reachable — they select the *server's*
output device, which is meaningless once server and user are different
machines. Streaming piper's PCM to the browser, which keeps the voice quality,
is a real protocol change to `streamTurn` and deserves its own design pass.

**Until that lands, deploy with the voice tracks understood to be broken for
anyone who is not sitting at the server.** The coding track — the one that
reads as NeetCode — is unaffected: it needs no TTS.

## Replicas

Pinned to 1, and `strategy: Recreate` so a rolling update never briefly runs
two. `SessionStore` is an in-memory `Map`; a second pod answers for sessions it
has never heard of, depending on where the request lands. This is not a scaling
knob until that store is shared or the router is made sticky.
