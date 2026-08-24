-- The deployed store.
--
-- Two things live here that live in files locally: the problem definitions
-- (a serving copy — the repo always wins, see `ingest.ts`) and each person's
-- work. A local run never touches this file; `VOICE_MODE=local` has no
-- database at all.
--
-- Idempotent by construction: every statement is `if not exists` or `create or
-- replace`, so applying it to a live database is a no-op and a deploy does not
-- need to know whether it has run before.
--
-- Better Auth owns `user`, `session`, `account` and `verification` and
-- generates their DDL itself. They are deliberately absent here, and the
-- foreign keys that would point at them are added in `schema-auth.sql` once
-- those tables exist (phase 4) — reading the generated column type rather than
-- assuming one.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
--
-- Two, and the split is the whole point of this file.
--
-- `app_runtime` is what a request-serving connection uses. It cannot see a
-- problem's pattern or its solution, because those are revoked below rather
-- than filtered in application code. A repository function that forgets to
-- project is a bug; a route that runs `select * from problem` is an error from
-- the database.
--
-- `app_privileged` is the narrow door through the wall, used by exactly two
-- callers: the ingester, which writes the spoilers, and the boot-time problem
-- loader, which needs `pattern` for hint rung 2 and for the coach track. It
-- mirrors how `coachPaths` is today's only door in the filesystem code.
--
-- NOLOGIN, no passwords: these are group roles. A deployment creates its own
-- login role and grants it one of these, so credentials never live in the repo.

do $$ begin
  if not exists (select from pg_roles where rolname = 'app_runtime') then
    create role app_runtime nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'app_privileged') then
    create role app_privileged nologin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Problem definitions
-- ---------------------------------------------------------------------------

-- One header row per problem, keyed by (track, slug).
--
-- `pattern` is the spoiler: it is the single thing the coding drill exists to
-- test recall of, which is why it sits on the base table and not in the view.
--
-- `retired_at` rather than a delete: a directory reorganisation must not be
-- able to vaporise someone's history through a cascade.
create table if not exists problem (
  id            bigint generated always as identity primary key,
  track         text        not null,
  slug          text        not null,
  pattern       text,
  difficulty    text        not null default 'unrated',
  title         text,
  budget_note   text,
  complexity    jsonb       not null default '{}'::jsonb,
  companies     jsonb       not null default '[]'::jsonb,
  content_hash  text        not null,
  -- A second, narrower hash over the `stub` and `test` documents only.
  -- `solution_buffer.based_on_content_hash` is compared against this to decide
  -- whether someone's in-progress code predates a change to the exercise. It is
  -- separate from `content_hash` on purpose: a README typo must not fire a
  -- staleness banner, because a signal that cries wolf stops being read.
  exercise_hash text        not null default '',
  source_commit text,
  retired_at    timestamptz,
  ingested_at   timestamptz not null default now(),
  unique (track, slug)
);

-- The problem's files, as content. `filename` is informational and is NEVER a
-- path: a path names the pattern directory, which is the answer.
--
-- `is_spoiler` is assigned once at ingest from the `kind`, not inferred per
-- query, so the view below is a single stable predicate rather than a list
-- every future reader has to remember to repeat. Which kinds count is decided
-- in `ingest.ts` — and `meta` is one of them, because the first line of every
-- `meta.yaml` is the pattern.
create table if not exists problem_document (
  problem_id  bigint  not null references problem(id) on delete cascade,
  kind        text    not null,
  filename    text    not null,
  content     text    not null,
  is_spoiler  boolean not null,
  primary key (problem_id, kind, filename),
  constraint problem_document_kind_known check (kind in (
    'readme', 'stub', 'test', 'solution', 'meta',
    'rubric', 'reference', 'src', 'repro_test', 'invariant_test'
  ))
);

-- The hint ladder's authored rungs. Own columns rather than a blob, because
-- the hint route reads a rung by number and should not have to know the shape
-- of someone's YAML.
--
-- Rung 2 is the pattern and rung 4 is the worked solution; neither is stored
-- here, because both already exist as `problem.pattern` and a `solution`
-- document and a second copy is a second thing to forget to scrub.
create table if not exists problem_hint (
  problem_id bigint not null references problem(id) on delete cascade,
  rung       int    not null,
  text       text   not null,
  primary key (problem_id, rung),
  constraint problem_hint_rung_authored check (rung in (1, 3))
);

create index if not exists problem_track_live_idx on problem (track) where retired_at is null;

-- ---------------------------------------------------------------------------
-- The projection gate
-- ---------------------------------------------------------------------------
--
-- `security_invoker` is off (the default), so these views run with the owner's
-- rights. That is what lets `app_runtime` read them while holding no privilege
-- on the tables underneath.

-- New columns go on the END of these select lists, always. `create or replace
-- view` refuses to reorder or remove one, so appending is what keeps this file
-- re-runnable against a database that already has an older version of the view.
create or replace view problem_public as
  select id, track, slug, difficulty, title, budget_note, complexity, companies,
         retired_at, exercise_hash
  from problem;

create or replace view problem_document_public as
  select problem_id, kind, filename, content
  from problem_document
  where is_spoiler = false;

-- There is deliberately no `problem_hint_public`. All four rungs of the ladder
-- are spoilers of different strengths — rung 1 nudges, rung 2 names the pattern
-- outright — and the thing that rations them is the server-side rung count, not
-- the grant. Handing `app_runtime` a view over rungs 1 and 3 would mean three of
-- the four were available to any query while the fourth needed the privileged
-- role, which is a distinction with no principle behind it. The hint route reads
-- them through `withPrivileged`, same door as the pattern.

-- ---------------------------------------------------------------------------
-- Per-user work
-- ---------------------------------------------------------------------------
--
-- `user_id` is `text` to match Better Auth's generated `user.id`, which is a
-- string id and not a uuid. The foreign key is added in phase 4, when that
-- table exists; the column type is already the one the generator emits.
--
-- `drill_log` deliberately has no `pattern` column. It joins to
-- `problem.pattern` behind the gate above, so a future migration cannot forget
-- to scrub a second copy.

create table if not exists solution_buffer (
  id                    bigint generated always as identity primary key,
  user_id               text        not null,
  problem_id            bigint      not null references problem(id) on delete cascade,
  content               text        not null,
  based_on_content_hash text,
  updated_at            timestamptz not null default now(),
  unique (user_id, problem_id)
);

-- `verified_by` records whether the verdict came from server-side vitest or
-- from the candidate's own browser. A browser verdict is forgeable by
-- definition; the point is that it is distinguishable, not that it is
-- prevented. See the plan's "Verdict trust" section.
create table if not exists drill_log (
  id          bigint generated always as identity primary key,
  user_id     text        not null,
  problem_id  bigint      references problem(id) on delete set null,
  started_at  timestamptz not null,
  track       text        not null,
  solved      text        not null default 'unsolved',
  hints       int         not null default 0,
  elapsed_ms  bigint,
  verified_by text        not null default 'server',
  note        text        not null default '',
  constraint drill_log_solved_known check (solved in ('solved', 'partial', 'unsolved')),
  constraint drill_log_verified_by_known check (verified_by in ('server', 'browser'))
);

create table if not exists transcript (
  id         bigint generated always as identity primary key,
  user_id    text        not null,
  track      text        not null,
  problem_id bigint      references problem(id) on delete set null,
  started_at timestamptz not null,
  body       text        not null,
  transport  text
);

create table if not exists attempt_archive (
  id          bigint generated always as identity primary key,
  user_id     text        not null,
  problem_id  bigint      references problem(id) on delete set null,
  archived_at timestamptz not null default now(),
  content     text        not null
);

create table if not exists pairing_log (
  id          bigint generated always as identity primary key,
  user_id     text   not null,
  problem_id  bigint references problem(id) on delete set null,
  occurred_on date   not null,
  minutes     int    not null
);

create table if not exists story (
  id         bigint generated always as identity primary key,
  user_id    text        not null,
  competency text        not null,
  story      text        not null,
  worked     text        not null default '',
  fix        text        not null default '',
  created_at timestamptz not null default now()
);

create index if not exists drill_log_user_idx        on drill_log (user_id, started_at desc);
create index if not exists transcript_user_idx       on transcript (user_id, started_at desc);
create index if not exists attempt_archive_user_idx  on attempt_archive (user_id, archived_at desc);
create index if not exists pairing_log_user_idx      on pairing_log (user_id, occurred_on desc);
create index if not exists story_user_idx            on story (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
--
-- Every user-owned table, filtered on `app.user_id`, which the server sets from
-- the authenticated session at the top of each request. A repository call that
-- forgets its `where user_id` then returns nothing rather than someone else's
-- rows — the same shape as the grants above: the unsafe thing is unreachable,
-- not merely discouraged.
--
-- `current_setting(..., true)` returns null when unset rather than throwing, so
-- an unauthenticated connection sees zero rows instead of an error that a
-- caller might be tempted to catch.

do $$
declare t text;
begin
  foreach t in array array[
    'solution_buffer', 'drill_log', 'transcript',
    'attempt_archive', 'pairing_log', 'story'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_own_rows', t);
    execute format(
      'create policy %I on %I using (user_id = current_setting(''app.user_id'', true))'
      || ' with check (user_id = current_setting(''app.user_id'', true))',
      t || '_own_rows', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to app_runtime, app_privileged;

-- The revoke is the load-bearing line. `app_runtime` holds nothing on the
-- problem base tables, so `select pattern from problem` fails at the database
-- rather than returning the answer.
revoke all on problem, problem_document, problem_hint from app_runtime;
grant select on problem_public, problem_document_public to app_runtime;

grant select, insert, update, delete on
  solution_buffer, drill_log, transcript, attempt_archive, pairing_log, story
  to app_runtime;
grant usage, select on all sequences in schema public to app_runtime;

-- The ingester writes definitions; the boot loader reads `pattern`. Neither
-- touches per-user work, and that is enforced rather than assumed.
grant select, insert, update, delete on problem, problem_document, problem_hint to app_privileged;
grant usage, select on all sequences in schema public to app_privileged;
revoke all on solution_buffer, drill_log, transcript, attempt_archive, pairing_log, story
  from app_privileged;
