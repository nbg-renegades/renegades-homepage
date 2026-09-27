import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { findLeagueSeason } from './config.ts';
import { parseLiveticker, parseSnapshot, type UpstreamGameday } from './schema.ts';
import {
  classifyGameday,
  findScoreDisagreements,
  involvesTrackedTeam,
  mapTeamSnapshot,
  selectLeagueSeasonGamedays,
  todaysTrackedGameIds,
  toGamedayRow,
  toGameEventRows,
  toGameRow,
  toLiveGameRows,
} from './mappers.ts';
import { loadFixture } from './__fixtures__/load.ts';

async function teamSnapshot(): Promise<readonly UpstreamGameday[]> {
  const parsed = parseSnapshot(await loadFixture('snapshot.teams-159-287.json'));
  assert(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
  return parsed.value.gamedays;
}

function gameday(gamedays: readonly UpstreamGameday[], id: number): UpstreamGameday {
  const found = gamedays.find((g) => g.id === id);
  assert(found !== undefined, `gameday ${id} must be in the fixture`);
  return found;
}

// ── Gamedays ─────────────────────────────────────────────────────────────────

Deno.test('a placeholder address becomes null, a real one is kept', async () => {
  const gamedays = await teamSnapshot();

  // "Adresse folgt in der Einladung"
  assertEquals(toGamedayRow(gameday(gamedays, 844), '2026-09-27').address, null);
  // A city name on its own is a real address.
  assertEquals(toGamedayRow(gameday(gamedays, 852), '2026-09-27').address, 'Königsbrunn');
  assertEquals(
    toGamedayRow(gameday(gamedays, 645), '2026-09-27').address,
    'Hofer Straße 30, 90411 Nürnberg',
  );
});

Deno.test('a gameday is classified against today, not against its own status', async () => {
  const gamedays = await teamSnapshot();
  const gd = gameday(gamedays, 852); // 2026-06-20

  assertEquals(classifyGameday(gd, '2026-06-19'), 'upcoming');
  assertEquals(classifyGameday(gd, '2026-06-21'), 'past');
  // It still has unplayed games, so on the day itself it is live.
  assertEquals(classifyGameday(gd, '2026-06-20'), 'today');
});

Deno.test('a gameday abandoned mid-game months ago is past, not permanently live', async () => {
  const gamedays = await teamSnapshot();
  // Gameday 893 (2026-07-25) still holds a game marked "2. Halbzeit".
  const gd = gameday(gamedays, 893);
  assert(gd.games.some((g) => g.status === '2. Halbzeit'));
  assertEquals(classifyGameday(gd, '2026-09-27'), 'past');
});

Deno.test('a gameday whose games are all finished is past on the day itself', async () => {
  const gamedays = await teamSnapshot();
  const gd = gameday(gamedays, 645); // every game beendet
  assertEquals(classifyGameday(gd, gd.date), 'past');
});

// ── Games ────────────────────────────────────────────────────────────────────

Deno.test('the sides are resolved by isHome and the scores add up', async () => {
  const gamedays = await teamSnapshot();
  const game = gameday(gamedays, 645).games.find((g) => g.id === 7374);
  assert(game !== undefined);

  const row = toGameRow(game);
  assertEquals(row.home_team_id, 112);
  assertEquals(row.away_team_id, 159);
  assertEquals(row.home_name, 'LLions');
  assertEquals(row.away_name, 'Nürn');
  // fh + sh per side, which is also the opponent's `pa`.
  assertEquals(row.home_score, 52);
  assertEquals(row.away_score, 32);
  assertEquals(row.home_ht, 28);
  assertEquals(row.away_ht, 19);
  assertEquals(row.finished, true);
  assertEquals(row.gameday_id, 645);
});

Deno.test('an unplayed game stores no score rather than nil-nil', async () => {
  const gamedays = await teamSnapshot();
  const game = gameday(gamedays, 852).games.find((g) => g.status === 'Geplant');
  assert(game !== undefined);

  const row = toGameRow(game);
  // Upstream reports final_score {home: 0, away: 0} here; a stored 0 would be indistinguishable
  // from a real scoreless draw.
  assertEquals(row.home_score, null);
  assertEquals(row.away_score, null);
  assertEquals(row.home_ht, null);
  assertEquals(row.finished, false);
  // The kickoff time is still known even though nothing has been played.
  assertEquals(row.scheduled, '11:10:00');
});

Deno.test('a game not involving our teams is recognised as such', async () => {
  const gamedays = await teamSnapshot();
  const gd = gameday(gamedays, 645);
  const ours = gd.games.filter(involvesTrackedTeam);

  assert(ours.length > 0);
  assert(ours.length < gd.games.length, 'a gameday holds other clubs’ games too');
  for (const game of ours) {
    assert(game.results.some((r) => r.team_id === 159 || r.team_id === 287));
  }
});

// ── Play-by-play rows ────────────────────────────────────────────────────────

Deno.test('event rows carry the running score and end at the official result', async () => {
  const gamedays = await teamSnapshot();
  const game = gameday(gamedays, 645).games.find((g) => g.id === 7374);
  assert(game !== undefined);

  const rows = toGameEventRows(game);
  assert(rows.length > 0);
  assertEquals(rows.every((r) => r.game_id === 7374), true);

  const last = rows.at(-1);
  assert(last !== undefined);
  assertEquals(last.score_home, 52);
  assertEquals(last.score_away, 32);

  // A possession marker is flagged and scores nothing.
  const markers = rows.filter((r) => r.is_marker);
  assert(markers.length > 0);
  assertEquals(markers.every((r) => r.points === 0), true);

  // The deleted entry is kept as a row so the UI can strike it through.
  const deleted = rows.filter((r) => r.is_deleted);
  assertEquals(deleted.length, 1);
  assertEquals(deleted[0].points, 0);
});

Deno.test('a game without logs yields no event rows', async () => {
  const gamedays = await teamSnapshot();
  const game = gameday(gamedays, 645).games[0];
  assertEquals(toGameEventRows({ ...game, log: null }), []);
});

Deno.test('no recorded game disagrees with upstream on its half scores', async () => {
  const gamedays = await teamSnapshot();
  const found = gamedays.flatMap((gd) => gd.games.flatMap(findScoreDisagreements));
  assertEquals(found, []);
});

Deno.test('an unknown scoring event is reported as a disagreement, not swallowed', async () => {
  const gamedays = await teamSnapshot();
  const game = gameday(gamedays, 645).games.find((g) => g.id === 7374);
  assert(game?.log != null);

  // Pretend upstream introduced a 3-point event we do not know.
  const tampered = {
    ...game,
    log: {
      ...game.log,
      home: {
        ...game.log.home,
        firsthalf: {
          score: game.log.home.firsthalf.score + 3,
          entries: game.log.home.firsthalf.entries,
        },
      },
    },
  };

  const found = findScoreDisagreements(tampered);
  assertEquals(found.length, 1);
  assertEquals(found[0].side, 'home');
  assertEquals(found[0].half, 1);
  assertEquals(found[0].reported - found[0].computed, 3);
});

// ── The whole snapshot ───────────────────────────────────────────────────────

Deno.test('mapping a team snapshot keeps only our games', async () => {
  const gamedays = await teamSnapshot();
  const mapped = mapTeamSnapshot(gamedays, '2026-09-27');

  assertEquals(mapped.gamedays.length, 4);
  assertEquals(mapped.disagreements, []);

  const expected = gamedays.flatMap((gd) => gd.games.filter(involvesTrackedTeam)).length;
  assertEquals(mapped.games.length, expected);
  assert(mapped.games.length < gamedays.flatMap((gd) => gd.games).length);

  // Every game row belongs to a gameday row we are storing.
  const gamedayIds = new Set(mapped.gamedays.map((g) => g.id));
  assert(mapped.games.every((g) => gamedayIds.has(g.gameday_id)));

  // Every event row belongs to a game row.
  const gameIds = new Set(mapped.games.map((g) => g.id));
  assert(mapped.events.every((e) => gameIds.has(e.game_id)));
});

Deno.test('a gameday with none of our games produces no rows at all', () => {
  const foreign: UpstreamGameday = {
    id: 9999,
    name: 'Someone else’s Spieltag',
    date: '2026-06-20',
    start: '10:00',
    league: 18,
    league_display: 'FF BL',
    season: 6,
    season_display: '2026',
    address: 'Irgendwo',
    status: 'PUBLISHED',
    games: [{
      id: 1,
      gameday: 9999,
      scheduled: '10:00:00',
      field: 1,
      stage: null,
      standing: null,
      status: 'beendet',
      results: [
        { team_id: 111, team_name: 'A', fh: 7, sh: 7, pa: 6, isHome: true },
        { team_id: 222, team_name: 'B', fh: 3, sh: 3, pa: 14, isHome: false },
      ],
      log: null,
    }],
  };

  const mapped = mapTeamSnapshot([foreign], '2026-09-27');
  assertEquals(mapped.gamedays, []);
  assertEquals(mapped.games, []);
});

Deno.test('league-season selection honours the league, the year and the exclusions', async () => {
  const parsed = parseSnapshot(await loadFixture('snapshot.league-dffl-2026.json'));
  assert(parsed.ok);
  const cfg = findLeagueSeason('dkb-dffl', '2026');
  assert(cfg !== undefined);

  const selected = selectLeagueSeasonGamedays(cfg, parsed.value.gamedays);
  assert(selected.length > 0);
  assertEquals(selected.every((gd) => gd.league_display === 'DKB DFFL'), true);
  assertEquals(selected.every((gd) => gd.date.startsWith('2026')), true);
  // The two playoff gamedays are excluded.
  assertEquals(selected.some((gd) => gd.id === 887 || gd.id === 888), false);
  assertEquals(selected.length, parsed.value.gamedays.length - 2);
});

// ── Live games ───────────────────────────────────────────────────────────────

Deno.test('only today’s games of our teams are eligible for live polling', async () => {
  const gamedays = await teamSnapshot();

  assertEquals(todaysTrackedGameIds(gamedays, '2026-09-27').size, 0);

  const ids = todaysTrackedGameIds(gamedays, '2026-06-20');
  assert(ids.size > 0);
  const gd = gameday(gamedays, 852);
  const ourIds = gd.games.filter(involvesTrackedTeam).map((g) => g.id);
  assertEquals([...ids].sort(), ourIds.sort());
});

Deno.test('live rows are limited to games we already hold', async () => {
  const parsed = parseLiveticker(await loadFixture('liveticker.default-5-ticks.json'));
  assert(parsed.ok);

  // The unfiltered liveticker returns other clubs' games — on the recording day, U16 games.
  assertEquals(toLiveGameRows(parsed.value, new Set()), []);

  const rows = toLiveGameRows(parsed.value, new Set([9149]));
  assertEquals(rows.length, 1);
  assertEquals(rows[0].game_id, 9149);
  // The score is taken from upstream rather than derived, because the default window holds
  // only the five newest ticks.
  assertEquals(rows[0].home_score, 39);
  assertEquals(rows[0].away_score, 26);
  assertEquals(rows[0].finished, true);
  assertEquals(rows[0].last_tick_at, '2026-09-27T11:42:48.715832+00:00');
});

Deno.test('the last tick time is the newest instant, whatever order they arrive in', async () => {
  const parsed = parseLiveticker(await loadFixture('liveticker.get-all-ticks-for.json'));
  assert(parsed.ok);
  const game = parsed.value[0];

  const shuffled = { ...game, ticks: [...game.ticks].reverse() };
  const [normal] = toLiveGameRows([game], new Set([game.gameId]));
  const [reversed] = toLiveGameRows([shuffled], new Set([game.gameId]));
  assertEquals(normal.last_tick_at, reversed.last_tick_at);

  const newest = Math.max(...game.ticks.map((t) => Date.parse(t.time)));
  assertEquals(Date.parse(normal.last_tick_at ?? ''), newest);
});

// ── Column parity ────────────────────────────────────────────────────────────

/**
 * Guards the row shapes against the migration's column names.
 *
 * A mapper field that no column matches is not a type error — PostgREST rejects it at runtime
 * with `Could not find the 'x' column`, which is how `start` (column `start_time`) and
 * `standing` (column `group_name`) were originally found, by running the function against a real
 * database. These lists are copied from `20260927170000_results_schema.sql`; update both together.
 */
const COLUMNS = {
  results_gamedays: ['id', 'date', 'start_time', 'name', 'league_display', 'address', 'status', 'phase'],
  results_games: [
    'id', 'gameday_id', 'scheduled', 'field', 'stage', 'group_name', 'status', 'finished',
    'home_team_id', 'away_team_id', 'home_name', 'away_name', 'home_score', 'away_score',
    'home_ht', 'away_ht',
  ],
  results_game_events: [
    'game_id', 'seq', 'half', 'side', 'text', 'points', 'score_home', 'score_away',
    'is_deleted', 'is_marker',
  ],
  results_live_games: ['game_id', 'home_score', 'away_score', 'last_tick_at', 'finished'],
} as const;

Deno.test('every mapped row uses only columns the tables actually have', async () => {
  const gamedays = await teamSnapshot();
  const mapped = mapTeamSnapshot(gamedays, '2026-06-20');
  const live = parseLiveticker(await loadFixture('liveticker.default-5-ticks.json'));
  assert(live.ok);

  // The row interfaces have no index signature, so they are read as plain objects here.
  const asRows = (rows: readonly object[]): readonly Record<string, unknown>[] =>
    rows as readonly Record<string, unknown>[];

  const checks: readonly [string, readonly Record<string, unknown>[], readonly string[]][] = [
    ['results_gamedays', asRows(mapped.gamedays), COLUMNS.results_gamedays],
    ['results_games', asRows(mapped.games), COLUMNS.results_games],
    ['results_game_events', asRows(mapped.events), COLUMNS.results_game_events],
    ['results_live_games', asRows(toLiveGameRows(live.value, new Set([9149, 9150]))), COLUMNS.results_live_games],
  ];

  for (const [table, rows, columns] of checks) {
    assert(rows.length > 0, `${table}: nothing to check`);
    const allowed = new Set<string>(columns);

    const unknown = [...new Set(rows.flatMap((row) => Object.keys(row)))]
      .filter((key) => !allowed.has(key));
    assertEquals(unknown, [], `${table}: no such column(s)`);

    // And the other way round, so a column the mapper forgot shows up too. `updated_at` is
    // added by the store, not the mapper.
    const produced = new Set(rows.flatMap((row) => Object.keys(row)));
    const missing = columns.filter((column) => !produced.has(column));
    assertEquals(missing, [], `${table}: column(s) never written`);
  }
});
