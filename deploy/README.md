# Deploying

A deployed instance is a different program from a local drill, and the
differences are the point rather than an accident of packaging.

| | local | deployed |
|---|---|---|
| Problems | `problems/` on disk | Postgres, written by `pnpm ingest` |
| Your work | Markdown in `local/` | Postgres, per person |
| Identity | none | Better Auth, anonymous by default |
| Grading | server-side vitest | the browser's Web Worker |
| Speech | the server speaks | the server synthesises, the browser plays |
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

## Who has the voice

Three arrangements, one of them chosen at startup and reported to the client as
`speech` on `GET /api/devices/output`:

| | who synthesises | who plays | when |
|---|---|---|---|
| `server` | the server | the server's speakers | local |
| `stream` | the server (piper) | the browser | deployed, with a voice model |
| `browser` | the browser | the browser | deployed, without one |

`stream` is preferred over `browser` because the browser's own
`SpeechSynthesis` is a lottery per browser and operating system — Chrome on
Linux frequently has no local English voice at all — and because the voice
should not change depending on who is drilling. It is a preference and not a
requirement: a missing piper or voice model degrades to `browser` and says so
in the startup banner, because a robotic voice is a better outcome than
refusing to serve a drill.

The client is *told* which it got rather than inferring it from the mode. Two
of these running at once is two overlapping voices, none of them is silence,
and neither failure announces itself.

The voice model is mounted, not baked — 60MB on a different release cadence
than the image:

```sh
mkdir -p models/piper && cd models/piper
curl -fsSL -O https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx \
             -O https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
```

Point `PIPER_VOICE` at a different `.onnx` to change the voice; the matching
`.onnx.json` must sit beside it. Unset it to force the browser's own voice.

`GET /api/session/:id/say/:seq` takes an index into what the interviewer has
already said, never the text to speak. A route that reads back whatever string
it is handed is an open text-to-speech service wearing a session id.

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

**No speaker choice.** Server-side *playback* exists locally for a specific
reason — `SpeechSynthesis` exposes no output-device API, so the browser cannot
route audio to a chosen speaker — and that reasoning collapses when the server
is elsewhere: the sentences would come out of a machine in a datacentre with
nobody in front of it. So deployed, the speaker picker is empty. There is no
server-side speaker to pick, and the browser plays through whatever the
operating system has selected.

**One piper process per sentence.** Synthesis is CPU on the same box that
serves requests, and it scales with concurrent drills rather than with users.
At a handful of people it is not close to a problem; it is the thing that
breaks first.

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
