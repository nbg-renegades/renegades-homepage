# Results parity checks

One-off scripts used to verify that the native results feature reproduces what the old
`renegades-scores` widget showed, before the iframe is retired. They are not part of the build
and nothing imports them.

They compare against `snapshot.json` from a clone of
[`phhbr/renegades-scores`](https://github.com/phhbr/renegades-scores), which is that widget's
pre-built data file. Adjust the `WIDGET` path at the top of each script.

## Running the sync against a throwaway database

`supabase start` works, but a plain Postgres plus PostgREST is faster and does not touch the
shared project:

```bash
# 1. Postgres, with the roles and the supabase_realtime publication the migrations expect
docker run -d --name results-db -e POSTGRES_PASSWORD=postgres -p 55432:5432 \
  public.ecr.aws/supabase/postgres:17.6.1.166

# 2. Apply both migrations from the performance repo
psql "$DB" -f ../../../renegades-performance/supabase/migrations/20260927170000_results_schema.sql
psql "$DB" -f ../../../renegades-performance/supabase/migrations/20260927170100_results_cron.sql

# 3. PostgREST. PGRST_JWT_SECRET must match the HS256 secret the keys below are signed with.
docker run -d --name results-postgrest -p 55433:3000 \
  -e PGRST_DB_URI="postgres://postgres:postgres@host.docker.internal:55432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="<32+ character secret>" \
  public.ecr.aws/supabase/postgrest:v16.1

# 4. Supabase serves PostgREST under /rest/v1; a bare container serves it at the root.
deno run --allow-net rest-proxy.ts

# 5. The function itself
cd ../../supabase/functions
SUPABASE_URL=http://localhost:55434 \
SUPABASE_SERVICE_ROLE_KEY="<JWT with role=service_role>" \
RESULTS_SYNC_CRON_SECRET=local-test-cron-secret \
  deno run --allow-net --allow-env --allow-read sync-leaguesphere/index.ts

curl -X POST http://localhost:8000/ -H 'x-cron-secret: local-test-cron-secret'
```

Mind the throttle while doing this: `/api/snapshot/` allows 60 requests an hour per IP, and one
full run spends six.

## The checks

- **`compare-widget.py`** — games, team names, scores and the finished flag, over the games
  present in both. Exits non-zero on any difference.
- **`compare-playbyplay.py`** — the running score at every scoring play, against the running
  scores the widget scraped from the game-detail HTML page.

  Ours is deliberately coarser. `/api/snapshot/` groups a touchdown and its conversion under one
  `sequence`, so we emit one row (`7:0`) where the widget's scrape emitted two (`6:0`, `7:0`).
  Splitting them would need that HTML page, which is out of bounds. The check therefore asserts
  that our progression is a subsequence of the widget's and ends on the same score.

## Result on 2026-09-27

```
games in our database (2026, teams 159/287): 49
games in the widget snapshot (same filter):   46
in both: 45 | only ours: 4 | only widget: 1
no field differences across 45 shared games (270 field comparisons)

games with play-by-play in both: 41
scoring plays compared: 349
progressions that are a subsequence of the widget's and end on the same score: 41/41
```

The five games that appear on only one side are all on 2026-09-19: that gameday was rebuilt
upstream after the widget's snapshot was taken on 2026-08-07, so its game ids changed.

## Replaying a gameday (`replay-live.ts`)

The live tab is the one part that cannot be checked by waiting for the data to look right — it
only does anything while a game is being played. `replay-live.ts` stands in for LeagueSphere and
hands out a progressively longer prefix of a recorded tick history, so a whole gameday can be run
through the real sync function in a minute.

Realtime is needed for this, which a bare PostgREST container does not provide, so use the full
local stack. If another local Supabase project is already running, give this one its own ports in
`supabase/config.toml` first (and put the file back afterwards — it is committed).

```bash
supabase start                      # note the API URL, ANON_KEY and SERVICE_ROLE_KEY it prints
# apply the three results migrations from the performance repo, then:
docker exec supabase_db_<ref> psql -U postgres -c "select cron.unschedule('results-sync-leaguesphere');"

deno run --allow-net --allow-read scripts/results-parity/replay-live.ts --port 8787

cd supabase/functions
LEAGUESPHERE_BASE_URL=http://localhost:8787 \
SUPABASE_URL=<API URL> SUPABASE_SERVICE_ROLE_KEY=<service role key> \
RESULTS_SYNC_CRON_SECRET=local-test-cron-secret \
  deno run --allow-net --allow-env --allow-read sync-leaguesphere/index.ts
```

Then, with `/ergebnisse/1-mannschaft/live?native=all` open in a browser pointed at the local stack,
repeat:

```bash
curl -X POST http://localhost:8787/advance
# the live ticker is due once a minute; this stands in for that minute passing
docker exec supabase_db_<ref> psql -U postgres -c \
  "update public.results_sync_state set last_ok_at = last_ok_at - interval '2 minutes' where source='liveticker';"
curl -X POST http://localhost:8000/ -H 'x-cron-secret: local-test-cron-secret'
```

### Result on 2026-09-27

The score walked the recorded game from 0:0 to 39:26 over 41 ticks and ended `finished`, and the
open page updated **748 ms** after the sync returned, without a reload. Letting the snapshot catch
up afterwards moved the game to `beendet` and its gameday to `past`, so it left the live tab and
appeared under "Gespielte Spieltage".

Running this is also what found three defects that no unit test would have: the two snapshot
scopes were concatenated without deduplicating, so a gameday in both failed the whole write; the
sync marked a scope successful before its rows were written, so a failing write looked healthy and
backed off for an hour; and the live ticker was gated on a game already being known to be in
progress, which is only known from the ten-minute snapshot — at a real kickoff the tab would have
stayed dark for up to ten minutes.
