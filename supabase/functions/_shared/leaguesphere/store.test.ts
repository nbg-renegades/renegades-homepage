import { assert, assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { ResultsStore, SYNC_SOURCES, StoreError, taskSource } from './store.ts';
import type { GamedayRow, GameEventRow } from './mappers.ts';
import type { StandingsRow } from './standings.ts';

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly prefer: string | null;
  readonly headers: Headers;
  readonly body: unknown;
}

function storeWith(responses: readonly Response[] = []) {
  const calls: Recorded[] = [];
  let index = 0;
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers ?? {});
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname.replace('/rest/v1', '') + (url.search === '' ? '' : url.search),
      prefer: headers.get('prefer'),
      headers,
      body: init?.body === undefined || init.body === null
        ? null
        : JSON.parse(String(init.body)),
    });
    const response = responses[index] ?? new Response(null, { status: 204 });
    index += 1;
    return Promise.resolve(response.clone());
  }) as typeof fetch;

  const store = new ResultsStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-role-key',
    fetchImpl,
    log: () => {},
  });
  return { store, calls };
}

function gameday(id: number): GamedayRow {
  return {
    id,
    date: '2026-06-20',
    start_time: '10:00',
    name: 'FF BL Spieltag',
    league_display: 'FF BL',
    address: 'Königsbrunn',
    status: 'PUBLISHED',
    phase: 'upcoming',
  };
}

// ── Authentication and request shape ─────────────────────────────────────────

Deno.test('every request authenticates as the service role', async () => {
  const { store, calls } = storeWith();
  await store.saveGamedays([gameday(1)]);

  assertEquals(calls[0].headers.get('apikey'), 'service-role-key');
  assertEquals(calls[0].headers.get('authorization'), 'Bearer service-role-key');
});

Deno.test('an upsert is a single atomic merge, returning nothing', async () => {
  const { store, calls } = storeWith();
  await store.saveGamedays([gameday(1), gameday(2)]);

  assertEquals(calls.length, 1, 'a batch is one request, not one per row');
  assertEquals(calls[0].method, 'POST');
  assertEquals(calls[0].path, '/results_gamedays?on_conflict=id');
  // merge-duplicates is what makes this INSERT ... ON CONFLICT DO UPDATE rather than a
  // read-then-write that two overlapping syncs could race on.
  assertStringIncludes(calls[0].prefer ?? '', 'resolution=merge-duplicates');
  assertStringIncludes(calls[0].prefer ?? '', 'return=minimal');
  assert(Array.isArray(calls[0].body));
});

Deno.test('an upsert stamps updated_at so staleness is visible in the row', async () => {
  const { store, calls } = storeWith();
  await store.saveGamedays([gameday(1)]);

  const rows = calls[0].body as Record<string, unknown>[];
  assert(typeof rows[0]['updated_at'] === 'string');
  assert(!Number.isNaN(Date.parse(rows[0]['updated_at'] as string)));
});

Deno.test('an empty batch makes no request at all', async () => {
  const { store, calls } = storeWith();
  await store.saveGamedays([]);
  await store.saveGames([]);
  await store.saveLiveGames([]);
  assertEquals(calls.length, 0);
});

Deno.test('a large batch is chunked rather than sent as one vast body', async () => {
  const { store, calls } = storeWith();
  await store.saveGamedays(Array.from({ length: 1200 }, (_, i) => gameday(i + 1)));

  assertEquals(calls.length, 3);
  assertEquals((calls[0].body as unknown[]).length, 500);
  assertEquals((calls[1].body as unknown[]).length, 500);
  assertEquals((calls[2].body as unknown[]).length, 200);
});

// ── Replace semantics ────────────────────────────────────────────────────────

/**
 * Play-by-play is replaced, not merged. Upstream corrects a mis-entered play by deleting the
 * entry, and an upsert would leave that row in our table for the rest of the season.
 */
Deno.test('game events are deleted before being written, scoped to one game', async () => {
  const { store, calls } = storeWith();
  const events: GameEventRow[] = [{
    game_id: 7374,
    seq: 1,
    half: 1,
    side: 'home',
    text: 'Touchdown: #3',
    points: 6,
    score_home: 6,
    score_away: 0,
    is_deleted: false,
    is_marker: false,
  }];

  await store.replaceGameEvents(7374, events);

  assertEquals(calls[0].method, 'DELETE');
  assertEquals(calls[0].path, '/results_game_events?game_id=eq.7374');
  assertEquals(calls[1].method, 'POST');
  assertStringIncludes(calls[1].path, 'on_conflict=game_id%2Chalf%2Cside%2Cseq');
});

Deno.test('standings are replaced per league season, not globally', async () => {
  const { store, calls } = storeWith();
  const rows: StandingsRow[] = [{
    leagueKey: 'ff-bl',
    season: '2026',
    teamId: 287,
    rank: 3,
    group: 'FF BL',
    sp: 23,
    s: 18,
    u: 0,
    n: 5,
    ep: 855,
    gp: 322,
    pd: 533,
    sq: 0.783,
    promotionRestricted: false,
    mode: 'official',
  }];

  await store.replaceStandings('ff-bl', '2026', rows);

  assertEquals(calls[0].method, 'DELETE');
  // Scoped: deleting the whole table would take the other league's standings with it.
  assertStringIncludes(calls[0].path, 'league_key=eq.ff-bl');
  assertStringIncludes(calls[0].path, 'season=eq.2026');

  // camelCase domain rows become snake_case columns.
  const written = (calls[1].body as Record<string, unknown>[])[0];
  assertEquals(written['league_key'], 'ff-bl');
  assertEquals(written['team_id'], 287);
  assertEquals(written['group_name'], 'FF BL');
  assertEquals(written['promotion_restricted'], false);
  assert(!('leagueKey' in written), 'camelCase keys must not reach PostgREST');
});

Deno.test('pruning live games clears both live tables, keeping today’s', async () => {
  const { store, calls } = storeWith();

  await store.pruneLiveGames([8983, 8985]);
  // The scores and their ticks have to go together, or the tab shows a feed for a game it no
  // longer has a score for.
  assertEquals(calls.map((call) => call.method), ['DELETE', 'DELETE']);
  assertStringIncludes(calls[0].path, '/results_live_games');
  assertStringIncludes(calls[0].path, 'game_id=not.in.(8983,8985)');
  assertStringIncludes(calls[1].path, '/results_live_ticks');
  assertStringIncludes(calls[1].path, 'game_id=not.in.(8983,8985)');

  calls.length = 0;
  await store.pruneLiveGames([]);
  // Nothing to keep means clear both, and the filter must still match every row:
  // PostgREST refuses an unfiltered DELETE.
  assertStringIncludes(calls[0].path, 'game_id=gte.0');
  assertStringIncludes(calls[1].path, 'game_id=gte.0');
});

Deno.test('live ticks are upserted on their own key, so re-delivery is free', async () => {
  const { store, calls } = storeWith();
  await store.saveLiveTicks([{
    game_id: 9149,
    tick_key: 'Touchdown: #75|2026-09-27T11:40:10.009392+00:00',
    text: 'Touchdown: #75',
    side: 'home',
    occurred_at: '2026-09-27T11:40:10.009Z',
    points: 6,
    is_marker: false,
  }]);

  assertEquals(calls[0].method, 'POST');
  assertStringIncludes(calls[0].path, 'on_conflict=game_id%2Ctick_key');
  assertStringIncludes(calls[0].prefer ?? '', 'resolution=merge-duplicates');
});

// ── Sync state ───────────────────────────────────────────────────────────────

/**
 * The failure contract. This is the behaviour hard constraint 4 asks for, expressed as the
 * columns a failed run is allowed to touch.
 */
Deno.test('a failure records the error and nothing else', async () => {
  const { store, calls } = storeWith();
  await store.recordFailure(SYNC_SOURCES.teamSnapshot, new Date('2026-09-27T16:00:00Z'), 'schema mismatch: snapshot.gamedays[0].id');

  const row = (calls[0].body as Record<string, unknown>[])[0];
  assertEquals(row['source'], 'snapshot:teams');
  assertStringIncludes(String(row['last_error']), 'schema mismatch');
  // Untouched, so the site keeps serving the last good data and still revalidates against the
  // ETag that worked.
  assert(!('last_ok_at' in row), 'a failure must not stamp last_ok_at');
  assert(!('etag' in row), 'a failure must not overwrite the known-good ETag');
});

Deno.test('a long upstream error is truncated rather than stored whole', async () => {
  const { store, calls } = storeWith();
  await store.recordFailure('snapshot:teams', new Date(), 'x'.repeat(5000));

  const row = (calls[0].body as Record<string, unknown>[])[0];
  assertEquals(String(row['last_error']).length, 2000);
});

Deno.test('a success stamps last_ok_at, stores the ETag and clears the error and the alert latch', async () => {
  const { store, calls } = storeWith();
  const at = new Date('2026-09-27T16:00:00Z');
  await store.recordSuccess(SYNC_SOURCES.teamSnapshot, at, '3066857c232b9f85c81f4f3fa5701d27', 4);

  const row = (calls[0].body as Record<string, unknown>[])[0];
  assertEquals(row['last_ok_at'], at.toISOString());
  assertEquals(row['etag'], '3066857c232b9f85c81f4f3fa5701d27');
  assertEquals(row['last_error'], null);
  assertEquals(row['calls_last_hour'], 4);
  // Clearing this re-arms the stale-data alert after a recovery.
  assertEquals(row['alerted_at'], null);
});

Deno.test('sync state loads into a map keyed by source', async () => {
  const { store } = storeWith([
    new Response(JSON.stringify([
      { source: 'snapshot:teams', etag: 'abc', last_ok_at: '2026-09-27T16:00:00Z', calls_last_hour: 2 },
      { source: 'liveticker', etag: null, last_ok_at: null, calls_last_hour: 0 },
    ]), { status: 200, headers: { 'content-type': 'application/json' } }),
  ]);

  const state = await store.loadSyncState();
  assertEquals(state.size, 2);
  assertEquals(state.get('snapshot:teams')?.etag, 'abc');
  assertEquals(state.get('liveticker')?.last_ok_at, null);
});

Deno.test('the league-scoped sources are distinct per league season', () => {
  assertEquals(SYNC_SOURCES.leagueTable('ff-bl', '2026'), 'league-table:ff-bl:2026');
  assertEquals(SYNC_SOURCES.leagueSnapshot('dkb-dffl', '2026'), 'snapshot:league:dkb-dffl:2026');
  // One league season failing must not look like another one succeeding.
  assert(SYNC_SOURCES.leagueTable('ff-bl', '2026') !== SYNC_SOURCES.leagueTable('dkb-dffl', '2026'));
});

Deno.test('every task maps to a source', () => {
  for (const task of ['team-snapshot', 'liveticker', 'league-table', 'league-snapshot'] as const) {
    assert(taskSource(task).length > 0);
  }
});

// ── Failures ─────────────────────────────────────────────────────────────────

Deno.test('a PostgREST error is raised with its status and detail', async () => {
  const { store } = storeWith([
    new Response(
      JSON.stringify({ code: '23503', message: 'insert or update on table "results_games" violates foreign key constraint' }),
      { status: 409 },
    ),
  ]);

  const error = await assertRejects(
    () => store.saveGames([{
      id: 1,
      gameday_id: 999,
      scheduled: null,
      field: null,
      stage: null,
      group_name: null,
      status: 'Geplant',
      finished: false,
      home_team_id: null,
      away_team_id: null,
      home_name: null,
      away_name: null,
      home_score: null,
      away_score: null,
      home_ht: null,
      away_ht: null,
    }]),
    StoreError,
  );
  assertEquals(error.status, 409);
  assertStringIncludes(error.message, 'foreign key constraint');
});

Deno.test('a store error never contains the service role key', async () => {
  const { store } = storeWith([new Response('nope', { status: 500 })]);
  const error = await assertRejects(() => store.saveGamedays([gameday(1)]), StoreError);
  assert(!error.message.includes('service-role-key'));
});

Deno.test('a 204 with no body is not treated as a parse failure', async () => {
  const { store } = storeWith([new Response(null, { status: 204 })]);
  await store.saveGamedays([gameday(1)]);
});
