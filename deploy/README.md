# Deploying

A deployed instance is a different program from a local drill, and the
differences are the point rather than an accident of packaging.

| | local | deployed |
|---|---|---|
| Problems | `problems/` on disk | Postgres, written by `pnpm ingest` |
| Your work | Markdown in `local/` | Postgres, per person |
| Identity | none | Better Auth, anonymous by default |
| Grading | server-side vitest | the browser's Web Worker |
| Speech | the server speaks | the browser speaks, via `SpeechSynthesis` |
| Bind | `127.0.0.1` | every interface, behind the container |

`VOICE_MODE` selects, once, at startup. An unrecognised value is a throw naming
the value rather than a quiet fall back to local.

## Running it

```sh
cp deploy/env.example deploy/.env      # then fill it in
docker compose -f deploy/compose.yaml --env-file deploy/.env up --build -d
docker compose -f deploy/compose.yaml --env-file deploy/.env exec app \
  node_modules/.bin/tsx scripts/ingest.ts
```

Then open `http://127.0.0.1:4173`. Signing in happens by itself.

`pnpm ingest` is a deploy step and not something the server does on boot: a bad
ingest would take request-serving down on every restart, and a good one would
make every restart pay for a full scan of the tree. It is idempotent — a second
run reports every problem `unchanged` — and `--dry-run` names what would move
without moving it.

The **schema** is applied at startup, which is a different decision. It is
idempotent, it is what makes the database answerable at all, and leaving it to
`ingest` means a fresh deployment crash-loops on `role "app_privileged" does not
exist` — a true sentence that tells nobody what to do.

## What has to be set

Three things have no default and will stop the process rather than let it start
in a state that looks like it worked:

- `DATABASE_URL` — a default of `postgres://localhost/postgres` would connect to
  whatever happened to be listening and report success.
- `AUTH_SECRET` — generated at boot it would sign everyone out on every restart
  and differ between replicas; hard-coded it would be the same secret on every
  deployment of this code, which is the same as having none.
- `VOICE_BACKEND` — a transport nobody chose is one discovered mid-drill.

`AUTH_BASE_URL` must match the origin a browser actually types. Cookies are
scoped to it and Better Auth checks state-changing requests against it, so a
mismatch shows up as sign-up failing with `MISSING_OR_NULL_ORIGIN` and nothing
else being obviously wrong.

## Bringing an existing `local/` record across

Once, by hand, after `ingest`:

```sh
pnpm migrate-local --user <id> --dry-run   # read the rejects
pnpm migrate-local --user <id>
```

Find the id in the `user` table, or sign in and read it from
`/api/auth/get-session`. Nothing is normalised and nothing is guessed at: a line
that does not parse goes to `local/migration-rejects.md` verbatim rather than
being inserted with nulls.

## Known limitations

**No speaker choice, and the voice is whatever the browser has.** Server-side
speech exists locally for a specific reason — `SpeechSynthesis` exposes no
output-device API, so the browser cannot route audio to a chosen speaker — and
that reasoning collapses when the server is elsewhere: the sentences would come
out of a machine in a datacentre with nobody in front of it. So deployed, the
browser speaks (`voice/web/src/browserVoice.ts`) and the speaker picker is
empty, because there is no longer a server-side speaker to pick. Which voice
you get depends on the browser and the operating system; the app prefers a
local English one and takes a remote one rather than staying silent. Whisper is
still needed and still runs — the browser uploads audio to be transcribed.

Exactly one of the two speaks each sentence, and which one is `serverSpeaks` in
the `GET /api/devices/output` response, derived from whether a `deps.speaker`
is actually installed rather than from `VOICE_MODE`. Inferring it client-side
would fail as either two overlapping voices or silence, and neither announces
itself.

**One replica.** `SessionStore` is an in-memory `Map`, so a second pod would
answer for sessions it has never heard of. Better Auth's own session lookup is
stateless and replica-safe; the two are unrelated, and it is this store that
pins the number. A restart drops every live session — honest and bounded, but
the blast radius grows with users.

**A browser-computed verdict is forgeable.** `drill_log.verified_by` records
`browser` or `server` so it is distinguishable rather than prevented. See
AGENTS.md, "Grading in the browser".

**Anonymous rows accumulate.** Every unauthenticated visit creates a real user
row. That needs a retention job, which does not exist yet.

## Kubernetes

`k8s.yaml` is deliberately absent. There is one on the `worktree-neetcode-deploy`
branch, and it is written for a model this replaces — *"this instance belongs to
one person… the app does not ask who is calling"* — which stopped being true the
moment identity landed. Adapting it is real work, and writing a manifest here
that nobody has applied to a cluster would be a file that looks like it has been
tried. The compose stack above has been run end to end; that is the difference.
