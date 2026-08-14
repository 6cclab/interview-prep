# Deploying an instance

A deployed instance is a **different mode**, not a local one with the lock off.
Local instances are untouched by everything here: `VOICE_MODE` defaults to
`local`, and `userDataDir(root, null)` returns `local/` byte-for-byte.

## What deployed mode changes

| | local | deployed |
|---|---|---|
| Identity | none, headers never read | Authentik uid, required, 401 otherwise |
| State | `local/` | `local/users/<uid>/` |
| Sessions | one, globally | one **per person** |
| Tests | vitest, server-side | in the browser, verdict posted back |
| Coach track | open — it is your own choice | allowlist only |
| TTS | speaks on this machine | see "Voice", below |

## Before the first deploy

Move the existing single-user history into a per-user directory:

```bash
pnpm tsx scripts/migrate-local-to-user.ts <your-authentik-uid>
```

Idempotent, and it leaves `local/certs/` alone — mkcert material belongs to the
machine, not a person.

## Running it on your own machine

**For an ordinary drill, none of this applies.** `pnpm mock:web` is unchanged:
`VOICE_MODE` defaults to `local`, no headers are read, and the container is not
involved. Reach for the image only when the thing you want to test *is* the
deployed build.

The image bakes `VOICE_MODE=deployed`, so it refuses every `/api/` request
without an Authentik uid — that is `deriveUserId` failing closed, and it is the
whole point of the three layers below. Pointed a browser straight at it, you
get a page that loads and every track showing **Unavailable**, because each
problem list came back 401.

`VOICE_MODE=local` on the container is not the way round it: local mode runs
`checkSpeechEngine()`, there is no piper in the image, and it binds loopback
inside its own namespace. It exits immediately, correctly.

Put the edge in front instead — the same thing the cluster does:

```bash
pnpm deploy:image                        # build
pnpm deploy:run                          # container on 4199, deployed mode
pnpm deploy:edge                         # edge on 4200  -> open this one
```

`scripts/deploy-edge.ts` reproduces the middleware chain in the order that
matters: clear `x-authentik-*`, then set the uid, then stamp the gateway
secret. `EDGE_UID` chooses who you are (default `ak-local`), which is also how
you exercise per-user isolation — two uids, two `local/users/<uid>/`
directories. It listens on 127.0.0.1 only, and it is a proxy rather than a
server flag deliberately: an env var that let the server accept an identity it
was never given would be an auth bypass one misconfiguration away from
production.

## Configuration

Everything the container needs, and what happens when it is missing.

| Variable | From | Missing means |
|---|---|---|
| `VOICE_MODE` | Dockerfile | `local` — no identity check at all. An unrecognised value refuses to start rather than falling back. |
| `VOICE_BACKEND` | manifest | refuses to start; a transport you did not choose is one you discover mid-drill |
| `OLLAMA_HOST` | ConfigMap | refuses to start in deployed mode, because ollama's own default is loopback and a container's loopback is itself |
| `OLLAMA_API_KEY` | Infisical | **silent** — absent means unauthenticated by design, so the gateway 401s on the first turn |
| `VOICE_COACH_ALLOWLIST` | ConfigMap | nobody may open the coach track, which is the safe default |
| `VOICE_GATEWAY_SECRET` | Infisical | every request is a 401, since `deriveUserId` fails closed |

`OLLAMA_API_KEY` is the one with no boot-time signal. It is deliberate —
pointing `OLLAMA_HOST` at a bare ollama box must keep working, so absent has to
mean unauthenticated rather than an error (`voice/ollama.ts`, `ollamaHeaders`).
It also runs in the opposite direction to `VOICE_GATEWAY_SECRET`: that one
authenticates Traefik **to** this server, this one authenticates this server
**to** the ollama gateway. They are two different secrets and must not be
merged.

Both live in Infisical, provisioned by the `HomelabSecret` in `k8s.yaml` the
same way every other service in the cluster gets its credentials. **The
Infisical project does not exist yet** — create it, put its UUID in the
`projectId` field, and add the two keys before applying.

## Identity, and why there are three layers

A forged `X-authentik-uid` reads and writes someone else's drill log, and
nothing about the response would look wrong. So no single control is trusted:

1. **ClusterIP + NetworkPolicy** — only Traefik can reach the port.
2. **Middleware order** — `clear-identity` → `forwardauth` → `gateway-secret`.
   `forwardAuth` does *not* strip a client-supplied header of the same name
   before the outpost repopulates it, so the clear step must come first. This
   is the ordering bug that makes identity forgeable.
3. **Gateway secret** — set only by the edge, compared in constant time.
   `deriveUserId` returns null without it, and a null identity is a 401.

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
