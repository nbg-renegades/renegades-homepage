import { assert, assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { throttledError } from './client.ts';
import {
  BUDGET_SOURCES,
  blocksFromPersistedState,
  endpointForSource,
  ResultsStore,
  SYNC_SOURCES,
  StoreError,
  taskSource,
} from './store.ts';
import type { SyncStateRow } from './store.ts';
import type { GamedayRow, GameEventRow } from './mappers.ts';
import type { EventKey } from './reconcile.ts';
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

// ── Paged reads and play-by-play diff writes ─────────────────────────────────

function jsonPage(rows: number): Response {
  return new Response(JSON.stringify(Array.from({ length: rows }, (_, i) => ({ id: i }))), {
    status: 200,
  });
}

function eventRow(gameId: number, seq: number, half: 1 | 2 = 1, side: 'home' | 'away' = 'home') {
  return {
    game_id: gameId,
    seq,
    half,
    side,
    text: 'Touchdown: #3',
    points: 6,
    score_home: 6,
    score_away: 0,
    is_deleted: false,
    is_marker: false,
  } satisfies GameEventRow;
}

Deno.test('selectAll pages until an empty page', async () => {
  const { store, calls } = storeWith([jsonPage(500), jsonPage(500), jsonPage(274), jsonPage(0)]);

  const rows = await store.selectAll('results_games', 'select=id&order=id');

  assertEquals(rows.length, 1274);
  assertEquals(calls.map((call) => call.method), ['GET', 'GET', 'GET', 'GET']);
  assertEquals(calls.map((call) => call.path), [
    '/results_games?select=id&order=id&limit=500&offset=0',
    '/results_games?select=id&order=id&limit=500&offset=500',
    '/results_games?select=id&order=id&limit=500&offset=1000',
    '/results_games?select=id&order=id&limit=500&offset=1274',
  ]);
});

Deno.test('selectAll keeps paging when the server caps below the page size', async () => {
  const { store, calls } = storeWith([jsonPage(300), jsonPage(300), jsonPage(0)]);

  const rows = await store.selectAll('results_games', 'select=id&order=id');

  // A short page does not mean the last one: PostgREST may be configured with a lower cap.
  assertEquals(rows.length, 600);
  assertEquals(calls.length, 3);
});

Deno.test('selectAll fails loudly on a non-array page', async () => {
  const { store } = storeWith([new Response('{"message":"nope"}', { status: 200 })]);

  await assertRejects(() => store.selectAll('results_games', 'select=id&order=id'), StoreError);
});

Deno.test('play-by-play is loaded in chunks of 100 game ids, ordered by key', async () => {
  const { store, calls } = storeWith([jsonPage(0), jsonPage(0)]);
  const ids = Array.from({ length: 150 }, (_, i) => 1000 + i);

  await store.loadGameEvents(ids);

  assertEquals(calls.length, 2);
  const lists = calls.map((call) => /game_id=in\.\(([^)]*)\)/.exec(call.path)?.[1].split(','));
  assertEquals(lists[0]?.length, 100);
  assertEquals(lists[1]?.length, 50);
  assertEquals(lists[0]?.[0], '1000');
  assertEquals(lists[1]?.[0], '1100');
  for (const call of calls) {
    assertStringIncludes(call.path, 'order=game_id,half,side,seq');
    assertStringIncludes(
      call.path,
      'select=game_id,seq,half,side,text,points,score_home,score_away,is_deleted,is_marker',
    );
  }
});

Deno.test('loading play-by-play for no games makes no request', async () => {
  const { store, calls } = storeWith();
  assertEquals(await store.loadGameEvents([]), []);
  assertEquals(calls.length, 0);
});

Deno.test('vanished plays are deleted per game by composite key, 40 at a time', async () => {
  const { store, calls } = storeWith();
  const keys: EventKey[] = [];
  for (let seq = 1; seq <= 45; seq += 1) keys.push({ game_id: 7, half: 1, side: 'home', seq });
  keys.push({ game_id: 8, half: 2, side: 'away', seq: 3 });

  await store.deleteGameEvents(keys);

  assertEquals(calls.length, 3);
  assert(calls.every((call) => call.method === 'DELETE'));
  const first = calls[0].path;
  assert(
    first.startsWith('/results_game_events?game_id=eq.7&or=(and(half.eq.1,side.eq.home,seq.eq.1),'),
  );
  assertEquals(first.split('and(').length - 1, 40);
  assertEquals(calls[1].path.split('and(').length - 1, 5);
  assertEquals(
    calls[2].path,
    '/results_game_events?game_id=eq.8&or=(and(half.eq.2,side.eq.away,seq.eq.3))',
  );
});

Deno.test('changed plays are upserted on the composite key', async () => {
  const { store, calls } = storeWith();

  await store.saveGameEvents([eventRow(7, 1), eventRow(7, 2, 2, 'away')]);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].method, 'POST');
  assertEquals(calls[0].path, '/results_game_events?on_conflict=game_id%2Chalf%2Cside%2Cseq');
  assertEquals((calls[0].body as unknown[]).length, 2);
});

Deno.test('an empty diff makes no request', async () => {
  const { store, calls } = storeWith();
  await store.saveGameEvents([]);
  await store.deleteGameEvents([]);
  assertEquals(calls.length, 0);
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

Deno.test('standings are written before the teams that left are removed', async () => {
  const { store, calls } = storeWith();
  const row = (teamId: number): StandingsRow => ({
    leagueKey: 'ff-bl',
    season: '2026',
    teamId,
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
  });

  await store.saveStandings('ff-bl', '2026', [row(287), row(254)]);

  // Upsert first, so a reader never sees an empty table; then drop only what is missing.
  assertEquals(calls.map((call) => call.method), ['POST', 'DELETE']);
  assertStringIncludes(calls[0].path, 'on_conflict=league_key%2Cseason%2Cteam_id');
  assertStringIncludes(calls[1].path, 'league_key=eq.ff-bl');
  assertStringIncludes(calls[1].path, 'season=eq.2026');
  assertStringIncludes(calls[1].path, 'team_id=not.in.(287,254)');

  // camelCase domain rows become snake_case columns.
  const written = (calls[0].body as Record<string, unknown>[])[0];
  assertEquals(written['league_key'], 'ff-bl');
  assertEquals(written['team_id'], 287);
  assertEquals(written['group_name'], 'FF BL');
  assertEquals(written['promotion_restricted'], false);
  assert(!('leagueKey' in written), 'camelCase keys must not reach PostgREST');
});

Deno.test('an empty table is never written and never deletes anything', async () => {
  const { store, calls } = storeWith();

  await store.saveStandings('ff-bl', '2026', []);

  assertEquals(calls.length, 0);
});

Deno.test('the newest stored gameday date is read in one request', async () => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const found = storeWith([json([{ date: '2026-10-04' }])]);
  assertEquals(await found.store.newestGamedayDate(), '2026-10-04');
  assertEquals(found.calls.length, 1);
  assertEquals(found.calls[0].path, '/results_gamedays?select=date&order=date.desc&limit=1');

  const none = storeWith([json([])]);
  assertEquals(await none.store.newestGamedayDate(), null);
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
  await store.recordSuccess(SYNC_SOURCES.teamSnapshot, at, '3066857c232b9f85c81f4f3fa5701d27');

  const row = (calls[0].body as Record<string, unknown>[])[0];
  assertEquals(row['last_ok_at'], at.toISOString());
  assertEquals(row['etag'], '3066857c232b9f85c81f4f3fa5701d27');
  assertEquals(row['last_error'], null);
  // Clearing this re-arms the stale-data alert after a recovery.
  assertEquals(row['alerted_at'], null);
  // The budget is written once per tick by recordSnapshotBudget, never per scope.
  assert(!('calls_last_hour' in row));
});

Deno.test('each snapshot budget is stored on its own row', async () => {
  const { store, calls } = storeWith();
  const windowStartedAt = new Date('2026-09-30T09:15:00Z');
  const at = new Date('2026-09-30T09:40:00Z');
  await store.recordSnapshotBudget(BUDGET_SOURCES['snapshot-standings'], { calls: 4, windowStartedAt }, at);
  await store.recordSnapshotBudget(BUDGET_SOURCES.snapshot, { calls: 7, windowStartedAt }, at);

  const standings = (calls[0].body as Record<string, unknown>[])[0];
  assertEquals(standings['source'], 'snapshot:standings');
  assertEquals(standings['calls_last_hour'], 4);
  assertEquals(standings['calls_window_started_at'], '2026-09-30T09:15:00.000Z');

  const narrow = (calls[1].body as Record<string, unknown>[])[0];
  assertEquals(narrow['source'], 'snapshot:teams');
  assertEquals(narrow['calls_last_hour'], 7);

  for (const row of [standings, narrow]) {
    assert(!('etag' in row), 'recording the budget must not touch the ETag');
    assert(!('last_ok_at' in row), 'recording the budget is not a success');
    assert(!('last_error' in row), 'recording the budget must not clear a stored 429');
  }
});

Deno.test('the two snapshot budgets live on the teams and standings rows', () => {
  assertEquals(BUDGET_SOURCES, {
    snapshot: 'snapshot:teams',
    'snapshot-standings': 'snapshot:standings',
  });
});

Deno.test('every sync-state row maps to the budget its calls spend', () => {
  assertEquals(endpointForSource('snapshot:teams'), 'snapshot');
  assertEquals(endpointForSource('snapshot:draft'), 'snapshot');
  assertEquals(endpointForSource('snapshot:league:ff-bl:2026'), 'snapshot');
  assertEquals(endpointForSource('snapshot:standings'), 'snapshot-standings');
  assertEquals(endpointForSource('league-table:ff-bl:2026'), 'league-table');
  assertEquals(endpointForSource('liveticker'), 'liveticker');
  assertEquals(endpointForSource('something-else'), null);
});

function stateRow(source: string, lastError: string | null): SyncStateRow {
  return {
    source,
    etag: null,
    last_attempt_at: null,
    last_ok_at: null,
    last_error: lastError,
    calls_last_hour: 0,
    calls_window_started_at: null,
    alerted_at: null,
  };
}

Deno.test('a 429 stored on a row blocks the bucket of that row on the next tick', () => {
  const now = 1_700_000_000_000;
  // Written a minute ago with a ten-minute Retry-After: nine minutes are left.
  const live = throttledError(600_000, now - 60_000);

  const draft = blocksFromPersistedState([stateRow('snapshot:draft', live)], now);
  assertEquals([...draft], [['snapshot', now + 540_000]]);

  const standings = blocksFromPersistedState([stateRow('snapshot:standings', live)], now);
  assertEquals([...standings], [['snapshot-standings', now + 540_000]]);

  const ticker = blocksFromPersistedState([stateRow('liveticker', live)], now);
  assertEquals([...ticker], [['liveticker', now + 540_000]]);

  const expired = throttledError(60_000, now - 120_000);
  assertEquals(blocksFromPersistedState([stateRow('snapshot:teams', expired)], now).size, 0);
  assertEquals(
    blocksFromPersistedState([stateRow('snapshot:teams', 'HTTP 500 — upstream down')], now).size,
    0,
  );
  assertEquals(blocksFromPersistedState([stateRow('snapshot:teams', null)], now).size, 0);
  assertEquals(blocksFromPersistedState([stateRow('something-else', live)], now).size, 0);

  // Two rows of one bucket: the later instant wins.
  const later = throttledError(600_000, now);
  const both = blocksFromPersistedState([
    stateRow('snapshot:teams', live),
    stateRow('snapshot:draft', later),
  ], now);
  assertEquals(both.get('snapshot'), now + 600_000);
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

// ── Pruning ──────────────────────────────────────────────────────────────────

Deno.test('the stored scope is read from historyFrom on, with each gameday’s games', async () => {
  const gamedays = new Response(JSON.stringify(
    Array.from({ length: 150 }, (_, i) => ({ id: i + 1, status: 'PUBLISHED', date: '2026-06-20' })),
  ));
  const games = new Response(JSON.stringify([{ id: 900, gameday_id: 1 }]));
  const { store, calls } = storeWith([gamedays, jsonPage(0), games, jsonPage(0), jsonPage(0)]);

  const scope = await store.loadStoredScope('2026-01-01');

  assertEquals(scope.gamedays.length, 150);
  assertEquals(scope.games, [{ id: 900, gameday_id: 1 }]);
  assertStringIncludes(calls[0].path, '/results_gamedays?select=id,status,date&date=gte.2026-01-01');
  assertStringIncludes(calls[0].path, 'order=id');
  // Games come per 100 gamedays: chunks of 100 and 50 ids, each paged to its empty page.
  const chunks = calls.slice(2).filter((call) => call.path.includes('offset=0'));
  assertEquals(chunks.length, 2);
  assertStringIncludes(chunks[0].path, '/results_games?select=id,gameday_id&gameday_id=in.(1,2,');
  assertStringIncludes(chunks[1].path, 'gameday_id=in.(101,102,');
});

Deno.test('games and gamedays are deleted by id in chunks of 100', async () => {
  const { store, calls } = storeWith();

  await store.deleteGames(Array.from({ length: 150 }, (_, i) => i + 1));
  await store.deleteGamedays([7, 8]);

  assertEquals(calls.map((call) => call.method), ['DELETE', 'DELETE', 'DELETE']);
  assertStringIncludes(calls[0].path, '/results_games?id=in.(1,2,');
  assertEquals(calls[0].path.split(',').length, 100);
  assertStringIncludes(calls[1].path, '/results_games?id=in.(101,');
  assertEquals(calls[2].path, '/results_gamedays?id=in.(7,8)');
});

Deno.test('an empty delete list makes no request', async () => {
  const { store, calls } = storeWith();
  await store.deleteGames([]);
  await store.deleteGamedays([]);
  assertEquals(calls.length, 0);
});
