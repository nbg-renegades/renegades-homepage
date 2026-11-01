-- Results tables for the homepage (nbg-renegades/renegades-homepage).
--
-- This migration belongs to that site, not to the performance app, but it lives here because
-- this repo owns the shared project's migration history — the same arrangement as
-- 20260915093600_heartbeat.sql. Keep it byte for byte if it is ever reordered.
--
-- What it is for: the homepage currently embeds a third-party widget in an iframe to show
-- fixtures, results and standings. These tables let it serve that natively from Postgres. A
-- scheduled Edge Function (`sync-leaguesphere`) is the only writer; it reads LeagueSphere's
-- public JSON API. Visitors only ever read from here, never from LeagueSphere.
--
-- Two naming decisions, both because the project is shared:
--
--   * Every table is prefixed `results_`. Unprefixed names like `teams`, `games` or
--     `standings` in a schema the performance app also occupies are a collision waiting to
--     happen. A separate `results` schema would read better, but exposing one to PostgREST is
--     a project-wide API setting that would affect the other app, so a prefix it is.
--   * `start_time` and `group_name` rather than `start` and `group`, which are keywords.
--
-- Everything upstream sends is treated as data: no column here is ever interpolated into SQL
-- or rendered as HTML, and the sync validates every response against a schema before writing.
--
-- There is deliberately no teams table. LeagueSphere exposes only short forms ("Nürn",
-- "LLions") and no logos at all, so the readable names and the logo files are the club's own —
-- and they live in the website's repo as a committed JSON asset beside the images it names,
-- maintained the same way the roster and the sponsors are. Keeping them there means adding a
-- club is a pull request rather than a database write, and nothing here has to be seeded
-- before the site works.

-- ── Gamedays ─────────────────────────────────────────────────────────────────

create table if not exists public.results_gamedays (
  id bigint primary key,
  date date not null,
  -- Upstream sends 'HH:MM'; null when no start time is published.
  start_time time,
  name text not null,
  -- The only league identifier a gameday carries upstream. Matching on it plus the year is
  -- how a gameday is attributed to a league season.
  league_display text not null,
  -- Normalised by the sync: 'tba', 'tbd' and the 'Adresse folgt…' family all become null, so
  -- the UI can simply omit the line. A city name on its own is a real address and is kept.
  address text,
  -- Upstream's editorial status: 'DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED' or ''.
  -- The empty string is a real value there and no status filter can select it, so this is
  -- deliberately not a check constraint.
  status text not null default '',
  -- Derived by the sync from the date and the games, because upstream's status describes
  -- editorial state and not progress. Games are left sitting unfinished for months.
  phase text not null default 'upcoming'
    constraint results_gamedays_phase_check check (phase in ('past', 'today', 'upcoming')),
  updated_at timestamptz not null default now()
);

-- The schedule tab reads by date in both directions, and the sync asks "what is on today".
create index if not exists results_gamedays_date_idx
  on public.results_gamedays (date desc);

comment on table public.results_gamedays is
  'One LeagueSphere gameday that at least one of our teams plays in.';

-- ── Games ────────────────────────────────────────────────────────────────────

create table if not exists public.results_games (
  id bigint primary key,
  gameday_id bigint not null
    references public.results_gamedays (id) on delete cascade,
  scheduled time,
  field smallint,
  stage text,
  -- Group within the gameday, e.g. 'Gruppe 1'.
  group_name text,
  -- Free text upstream and in German: 'Geplant', '1. Halbzeit', '2. Halbzeit', 'beendet'.
  -- Stored verbatim; `finished` is the derived flag everything actually reads.
  status text not null,
  finished boolean not null default false,
  home_team_id bigint,
  away_team_id bigint,
  -- The short names upstream puts on a result ("Nürn", "LLions"). Kept so a game still
  -- renders for a club the site has no display name for.
  home_name text,
  away_name text,
  -- Null until played, never 0. Upstream reports {home: 0, away: 0} for an unplayed fixture,
  -- and a stored 0:0 could not be told apart from a real scoreless draw.
  home_score smallint,
  away_score smallint,
  -- Half-time scores.
  home_ht smallint,
  away_ht smallint,
  updated_at timestamptz not null default now()
);

-- Foreign keys are not indexed automatically, and this one carries every read of a gameday's
-- games as well as the cascade.
create index if not exists results_games_gameday_id_idx
  on public.results_games (gameday_id);

-- "Every game team X played", for the per-team schedule.
create index if not exists results_games_home_team_id_idx
  on public.results_games (home_team_id);
create index if not exists results_games_away_team_id_idx
  on public.results_games (away_team_id);

-- The sync asks for unfinished games on a small number of days; a partial index keeps that
-- lookup off the bulk of the table, which is finished games and only grows.
create index if not exists results_games_unfinished_idx
  on public.results_games (gameday_id)
  where not finished;

comment on table public.results_games is
  'Games involving our teams. Other clubs'' games on the same gameday are not stored.';

-- ── Play-by-play ─────────────────────────────────────────────────────────────

create table if not exists public.results_game_events (
  game_id bigint not null
    references public.results_games (id) on delete cascade,
  -- Upstream's own sequence number, shared across both sides of a game.
  seq integer not null,
  half smallint not null
    constraint results_game_events_half_check check (half in (1, 2)),
  side text not null
    constraint results_game_events_side_check check (side in ('home', 'away')),
  -- Rendered text, e.g. 'Touchdown: #3, 1-Extra-Punkt: -'. Upstream content: always output as
  -- text, never as markup.
  text text not null,
  points smallint not null default 0,
  -- The score as it stood after this play, so the UI needs no running total of its own.
  score_home smallint not null default 0,
  score_away smallint not null default 0,
  -- A play voided upstream. Kept as a row so the UI can strike it through, but scores 0.
  is_deleted boolean not null default false,
  -- A possession change ('Turnover', 'Interception') rather than a play that scored.
  is_marker boolean not null default false,
  -- A side can appear in both buckets when a placeholder team is assigned twice upstream, so
  -- the side is part of the key.
  primary key (game_id, half, side, seq)
);

comment on table public.results_game_events is
  'Play-by-play per game, with the running score already resolved.';

-- ── Standings ────────────────────────────────────────────────────────────────

-- Stored verbatim from LeagueSphere's published table (`/api/league-table/`).
--
-- The site computes the same table itself on every sync and logs where the two disagree, but
-- it does not display its own numbers. For FF BL the two match exactly. For DKB DFFL they
-- cannot: that league divides win points by a fixed 30 rather than by games played, and
-- weights a win by the opponent's league, using ruleset configuration that no public endpoint
-- exposes. Publishing our own figures there would mean publishing wrong ones.
create table if not exists public.results_standings (
  -- Our own league key, e.g. 'ff-bl', 'dkb-dffl'. Not upstream's table slug, which differs.
  league_key text not null,
  season text not null,
  team_id bigint not null,
  rank smallint not null,
  -- Group within the league, e.g. 'Gruppe 1'.
  group_name text not null default '',
  -- Spiele, Siege, Unentschieden, Niederlagen.
  sp smallint not null,
  s smallint not null,
  u smallint not null,
  n smallint not null,
  -- Eigene Punkte and Gegenpunkte. Numeric because upstream reports them as floats.
  ep numeric(8, 1) not null,
  gp numeric(8, 1) not null,
  pd numeric(8, 1) not null,
  -- The league quotient, as upstream rounds it.
  sq numeric(6, 4) not null,
  -- A second team, which cannot be promoted. Greyed out in the table.
  promotion_restricted boolean not null default false,
  -- Where the row came from. 'official' is the only value today; a future computed mode would
  -- add one rather than change these rows in place.
  mode text not null default 'official'
    constraint results_standings_mode_check check (mode in ('official')),
  updated_at timestamptz not null default now(),
  primary key (league_key, season, team_id)
);

-- The table is always read a whole league season at a time, in rank order. The primary key
-- already covers the filter; this adds the ordering so the read needs no sort.
create index if not exists results_standings_rank_idx
  on public.results_standings (league_key, season, rank);

comment on table public.results_standings is
  'League tables as LeagueSphere publishes them. See the migration for why they are not computed here.';

-- ── Live games ───────────────────────────────────────────────────────────────

-- Only today's games of our teams ever appear here, and rows are cleared once a gameday is
-- over. The browser subscribes to this table over Realtime instead of polling.
create table if not exists public.results_live_games (
  game_id bigint primary key
    references public.results_games (id) on delete cascade,
  home_score smallint not null default 0,
  away_score smallint not null default 0,
  -- The newest tick's instant, shown as "last update" and used to spot a stalled ticker.
  last_tick_at timestamptz,
  finished boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.results_live_games is
  'Live scores for today''s games only. Subscribed to over Realtime by the browser.';

-- ── Sync bookkeeping ─────────────────────────────────────────────────────────

-- One row per upstream request scope. Holds the ETag that makes the next request conditional,
-- the outcome of the last attempt, and enough of a call count to stay inside upstream's
-- throttles across cold starts.
create table if not exists public.results_sync_state (
  -- e.g. 'snapshot:teams', 'snapshot:draft', 'liveticker', 'league-table:ff-bl:2026'.
  source text primary key,
  -- Sent back as If-None-Match. Stored in the quoted header form.
  etag text,
  last_attempt_at timestamptz,
  -- The site shows "Stand: <last_ok_at>", so a stale page is visibly stale rather than
  -- silently wrong.
  last_ok_at timestamptz,
  -- Null when the last attempt succeeded. A schema mismatch lands here and the data is left
  -- untouched.
  last_error text,
  calls_last_hour smallint not null default 0,
  -- Start of the window `calls_last_hour` counts within.
  calls_window_started_at timestamptz,
  -- Set when an alert has already gone out, so one incident sends one mail.
  alerted_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.results_sync_state is
  'Per-scope ETags, last outcome and call budget for the LeagueSphere sync.';

-- ── Row Level Security ───────────────────────────────────────────────────────

-- Every table: readable by everyone, writable by nobody.
--
-- There is deliberately no insert, update or delete policy anywhere below. The sync function
-- connects as service_role, which bypasses RLS entirely, so it needs no policy — and the
-- absence of one means a leaked anon key cannot write even if a policy is added carelessly
-- later. All of this is public sporting data; none of it is personal.
--
-- `results_sync_state` is the exception: it is operational, not content. It carries upstream
-- error strings and would let anyone read our sync posture, so anon gets nothing.

alter table public.results_gamedays enable row level security;
alter table public.results_games enable row level security;
alter table public.results_game_events enable row level security;
alter table public.results_standings enable row level security;
alter table public.results_live_games enable row level security;
alter table public.results_sync_state enable row level security;

drop policy if exists "results_gamedays are world readable" on public.results_gamedays;
create policy "results_gamedays are world readable"
  on public.results_gamedays for select to anon, authenticated using (true);

drop policy if exists "results_games are world readable" on public.results_games;
create policy "results_games are world readable"
  on public.results_games for select to anon, authenticated using (true);

drop policy if exists "results_game_events are world readable" on public.results_game_events;
create policy "results_game_events are world readable"
  on public.results_game_events for select to anon, authenticated using (true);

drop policy if exists "results_standings are world readable" on public.results_standings;
create policy "results_standings are world readable"
  on public.results_standings for select to anon, authenticated using (true);

drop policy if exists "results_live_games are world readable" on public.results_live_games;
create policy "results_live_games are world readable"
  on public.results_live_games for select to anon, authenticated using (true);

-- No policy on results_sync_state on purpose: RLS is enabled and nothing grants access, so
-- anon and authenticated see no rows at all.

-- ── Grants ───────────────────────────────────────────────────────────────────

-- Hosted projects created from ~Sep 2026 no longer inherit table grants for
-- anon/authenticated, while `supabase start` still grants them — so a local rehearsal cannot
-- catch a missing grant here. Without these, every read fails with "permission denied" even
-- though the policies above are correct. Same reasoning as
-- 20260924100000_explicit_table_grants.sql.
grant select on
  public.results_gamedays,
  public.results_games,
  public.results_game_events,
  public.results_standings,
  public.results_live_games
  to anon, authenticated;

-- Take away everything else. On an older project anon/authenticated inherited full DML on
-- every public table, so without this the only thing stopping a write is the absence of an
-- INSERT/UPDATE/DELETE policy — and RLS denies such a write *silently*, reporting "DELETE 0"
-- rather than an error. Revoking makes an attempted write fail loudly, and means a policy
-- added carelessly later still cannot grant writes to a public role.
revoke insert, update, delete, truncate, references, trigger on
  public.results_gamedays,
  public.results_games,
  public.results_game_events,
  public.results_standings,
  public.results_live_games
  from anon, authenticated;

-- Operational, not content: anon and authenticated get nothing at all here.
revoke all on public.results_sync_state from anon, authenticated;

-- service_role bypasses RLS but still needs the table privileges.
grant all on
  public.results_gamedays,
  public.results_games,
  public.results_game_events,
  public.results_standings,
  public.results_live_games,
  public.results_sync_state
  to service_role;

-- ── Realtime ─────────────────────────────────────────────────────────────────

-- The live tab subscribes to these two instead of polling. Added conditionally so re-running
-- the migration cannot fail on a duplicate.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'results_live_games'
  ) then
    alter publication supabase_realtime add table public.results_live_games;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'results_game_events'
  ) then
    alter publication supabase_realtime add table public.results_game_events;
  end if;
end;
$$;
