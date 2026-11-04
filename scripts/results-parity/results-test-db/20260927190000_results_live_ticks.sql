-- Live ticks for the homepage's results section (see 20260927170000_results_schema.sql).
--
-- Why this is not `results_game_events`. The same game reaches us through two different
-- channels, and they are not the same data:
--
--   * `/api/snapshot/` gives a *structured log*, grouped by upstream's own sequence number, with
--     a side per entry. That is what `results_game_events` holds, and the sync deletes and
--     rewrites a game's rows wholesale each time, because upstream corrects a mistake by
--     removing an entry.
--   * `/api/liveticker/` gives *text ticks* as they happen, including ones that belong to
--     neither side ("Spiel beendet", "2. Halbzeit gestartet") and ones that never appear in the
--     log at all (time-outs, penalties, clock updates).
--
-- Putting the second into the first would mean a nullable `side` on a column that is NOT NULL
-- for good reason, two sequence spaces colliding in one primary key, and the ten-minute snapshot
-- wiping the minute-by-minute ticks every time it ran. So they are separate, and the live tab
-- reads whichever is fresher.
--
-- Rows here live for one gameday. The sync clears them along with `results_live_games`.

create table if not exists public.results_live_ticks (
  game_id bigint not null
    references public.results_games (id) on delete cascade,
  -- `text|time` from upstream. The liveticker is cached 60s and its default response repeats the
  -- five newest ticks, so the same tick arrives many times; `time` is a full UTC instant rather
  -- than a clock reading, which makes this unique per play even when the same event happens
  -- twice in a game. Being the key means an upsert is idempotent and needs no read first.
  tick_key text not null,
  -- Upstream's German text, e.g. 'Touchdown: #75' or '1-Extra-Punkt: -'. Rendered as text only.
  text text not null,
  -- Null for a tick that belongs to neither side, which is exactly why this is not game_events.
  side text
    constraint results_live_ticks_side_check check (side is null or side in ('home', 'away')),
  -- The tick's own instant, which orders the feed and drives "last update".
  occurred_at timestamptz not null,
  points smallint not null default 0,
  -- A phase boundary rather than a play: kickoff, half time, full time.
  is_marker boolean not null default false,
  primary key (game_id, tick_key)
);

-- The feed is always read for one game, newest first.
create index if not exists results_live_ticks_game_time_idx
  on public.results_live_ticks (game_id, occurred_at desc);

comment on table public.results_live_ticks is
  'Live text ticks for today''s games. Cleared once the gameday is over; see results_game_events for the structured log.';

alter table public.results_live_ticks enable row level security;

drop policy if exists "results_live_ticks are world readable" on public.results_live_ticks;
create policy "results_live_ticks are world readable"
  on public.results_live_ticks for select to anon, authenticated using (true);

grant select on public.results_live_ticks to anon, authenticated;
grant all on public.results_live_ticks to service_role;

-- Writes stay with the service role, as everywhere else in this schema. Revoked explicitly
-- because RLS denies a write *silently* otherwise — "DELETE 0" rather than an error.
revoke insert, update, delete, truncate, references, trigger
  on public.results_live_ticks from anon, authenticated;

-- The live tab subscribes to this instead of polling.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'results_live_ticks'
  ) then
    alter publication supabase_realtime add table public.results_live_ticks;
  end if;
end;
$$;
