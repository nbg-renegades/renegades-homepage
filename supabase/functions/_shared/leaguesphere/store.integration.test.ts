/**
 * The store against a real Postgres and PostgREST, with the real results schema.
 *
 * Opt-in: every test is ignored unless `RESULTS_TEST_POSTGREST_URL` and `RESULTS_TEST_JWT_SECRET`
 * are readable, which `deno task test` (no `--allow-env`) never grants. Start the throwaway
 * database with `scripts/results-parity/results-test-db.sh up`, then run `deno task test:db`.
 *
 * Why this exists next to the fetch-stub tests in `store.test.ts`: a stub proves the request we
 * send, not what the database does with it. The 1000-row response cap and the foreign-key
 * cascades are properties of PostgREST and the schema, and a stub would simply agree with
 * whatever we assumed about them.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { ResultsStore } from './store.ts';
import type { GameEventRow, GameRow, GamedayRow, LiveGameRow, LiveTickRow } from './mappers.ts';

/** `Deno.env` throws without `--allow-env`; without it these tests are simply ignored. */
function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

const POSTGREST_URL = readEnv('RESULTS_TEST_POSTGREST_URL');
const JWT_SECRET = readEnv('RESULTS_TEST_JWT_SECRET');
const enabled = POSTGREST_URL !== undefined && POSTGREST_URL !== '' &&
  JWT_SECRET !== undefined && JWT_SECRET !== '';

/** Ids no real LeagueSphere gameday or game uses, so every test can clear its own rows. */
const GAMEDAY_ID = 990001;
const GAME_ID = 9900001;
const RESERVED_GAMEDAYS_FROM = 990000;

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_')
    .replaceAll('=', '');
}

/** An HS256 JWT with `role=service_role`, which is what PostgREST maps to the service role. */
async function serviceRoleJwt(secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64url(encoder.encode(JSON.stringify({ role: 'service_role' })));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

/**
 * Real `fetch`, minus the `/rest/v1` prefix: hosted Supabase serves PostgREST under it and a
 * bare PostgREST container does not (the same job `scripts/results-parity/rest-proxy.ts` does).
 */
const fetchWithoutPrefix = ((input: string | URL | Request, init?: RequestInit) =>
  fetch(String(input).replace('/rest/v1', ''), init)) as typeof fetch;

async function newStore(): Promise<ResultsStore> {
  return new ResultsStore({
    url: POSTGREST_URL ?? '',
    serviceRoleKey: await serviceRoleJwt(JWT_SECRET ?? ''),
    fetchImpl: fetchWithoutPrefix,
    log: () => {},
  });
}

/** Runs a test body against a clean reserved range, and leaves it clean. */
async function withStore(body: (store: ResultsStore) => Promise<void>): Promise<void> {
  const store = await newStore();
  const clear = () => store.deleteWhere('results_gamedays', `id=gte.${RESERVED_GAMEDAYS_FROM}`);
  await clear();
  try {
    await body(store);
  } finally {
    await clear();
  }
}

function gameday(id: number): GamedayRow {
  return {
    id,
    date: '2026-06-20',
    start_time: '10:00',
    name: 'Integration test gameday',
    league_display: 'Test',
    address: null,
    status: 'PUBLISHED',
    phase: 'past',
  };
}

function game(id: number, gamedayId: number): GameRow {
  return {
    id,
    gameday_id: gamedayId,
    scheduled: '10:00',
    field: 1,
    stage: null,
    group_name: null,
    status: 'beendet',
    finished: true,
    home_team_id: 159,
    away_team_id: 287,
    home_name: 'Home',
    away_name: 'Away',
    home_score: 7,
    away_score: 0,
    home_ht: 7,
    away_ht: 0,
  };
}

function event(gameId: number, seq: number, overrides: Partial<GameEventRow> = {}): GameEventRow {
  return {
    game_id: gameId,
    seq,
    half: 1,
    side: 'home',
    text: `Touchdown: #${seq}`,
    points: 6,
    score_home: 6,
    score_away: 0,
    is_deleted: false,
    is_marker: false,
    ...overrides,
  };
}

function keysOf(rows: readonly { half: number; side: string; seq: number }[]): string[] {
  return rows.map((row) => `${row.half}|${row.side}|${row.seq}`).sort();
}

Deno.test({
  name: 'PostgREST caps a plain select at 1000 rows',
  ignore: !enabled,
  fn: () =>
    withStore(async (store) => {
      await store.saveGamedays([gameday(GAMEDAY_ID)]);
      await store.saveGames([game(GAME_ID, GAMEDAY_ID)]);
      const events = Array.from({ length: 1200 }, (_, index) => event(GAME_ID, index + 1));
      await store.upsert('results_game_events', events, 'game_id,half,side,seq');

      const rows = await store.select(
        'results_game_events',
        `select=seq&game_id=eq.${GAME_ID}&order=seq`,
      );
      assertEquals(rows.length, 1000);
    }),
});

Deno.test({
  name: 'deleting a gameday cascades to its games, events and live rows',
  ignore: !enabled,
  fn: () =>
    withStore(async (store) => {
      const liveGame: LiveGameRow = {
        game_id: GAME_ID,
        home_score: 6,
        away_score: 0,
        last_tick_at: '2026-06-20T10:05:00Z',
        finished: false,
      };
      const tick: LiveTickRow = {
        game_id: GAME_ID,
        tick_key: 'tick-1',
        text: 'Touchdown: #1',
        side: 'home',
        occurred_at: '2026-06-20T10:05:00Z',
        points: 6,
        is_marker: false,
      };
      await store.saveGamedays([gameday(GAMEDAY_ID)]);
      await store.saveGames([game(GAME_ID, GAMEDAY_ID)]);
      await store.upsert(
        'results_game_events',
        [event(GAME_ID, 1), event(GAME_ID, 2), event(GAME_ID, 3)],
        'game_id,half,side,seq',
      );
      await store.saveLiveGames([liveGame]);
      await store.saveLiveTicks([tick]);

      await store.deleteWhere('results_gamedays', `id=eq.${GAMEDAY_ID}`);

      assertEquals((await store.select('results_games', `id=eq.${GAME_ID}`)).length, 0);
      assertEquals(
        (await store.select('results_game_events', `game_id=eq.${GAME_ID}`)).length,
        0,
      );
      assertEquals(
        (await store.select('results_live_games', `game_id=eq.${GAME_ID}`)).length,
        0,
      );
      assertEquals(
        (await store.select('results_live_ticks', `game_id=eq.${GAME_ID}`)).length,
        0,
      );
    }),
});

Deno.test({
  name: 'a composite-key or-filter deletes exactly the listed events',
  ignore: !enabled,
  fn: () =>
    withStore(async (store) => {
      await store.saveGamedays([gameday(GAMEDAY_ID)]);
      await store.saveGames([game(GAME_ID, GAMEDAY_ID)]);
      await store.upsert(
        'results_game_events',
        [
          event(GAME_ID, 1, { half: 1, side: 'home' }),
          event(GAME_ID, 2, { half: 1, side: 'away' }),
          event(GAME_ID, 3, { half: 2, side: 'home' }),
          event(GAME_ID, 4, { half: 2, side: 'away' }),
          event(GAME_ID, 5, { half: 2, side: 'home' }),
        ],
        'game_id,half,side,seq',
      );

      await store.deleteWhere(
        'results_game_events',
        `game_id=eq.${GAME_ID}&or=(and(half.eq.1,side.eq.home,seq.eq.1),and(half.eq.2,side.eq.away,seq.eq.4))`,
      );

      const left = await store.select<{ half: number; side: string; seq: number }>(
        'results_game_events',
        `select=half,side,seq&game_id=eq.${GAME_ID}`,
      );
      assertEquals(keysOf(left), ['1|away|2', '2|home|3', '2|home|5']);
    }),
});

Deno.test({
  name: 're-upserting the same events keeps one copy',
  ignore: !enabled,
  fn: () =>
    withStore(async (store) => {
      await store.saveGamedays([gameday(GAMEDAY_ID)]);
      await store.saveGames([game(GAME_ID, GAMEDAY_ID)]);
      const events = [event(GAME_ID, 1), event(GAME_ID, 2), event(GAME_ID, 3)];

      await store.upsert('results_game_events', events, 'game_id,half,side,seq');
      await store.upsert('results_game_events', events, 'game_id,half,side,seq');

      const rows = await store.select('results_game_events', `game_id=eq.${GAME_ID}`);
      assertEquals(rows.length, 3);
    }),
});
