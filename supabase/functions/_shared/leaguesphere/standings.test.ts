import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { findLeagueSeason, normaliseAddress, type LeagueSeasonConfig } from './config.ts';
import { parseLeagueTable, parseSnapshot, type UpstreamGameday } from './schema.ts';
import {
  computeStandings,
  diffStandings,
  mapOfficialTable,
  summariseCheck,
} from './standings.ts';
import { loadFixture } from './__fixtures__/load.ts';

function config(key: string, season = '2026'): LeagueSeasonConfig {
  const found = findLeagueSeason(key, season);
  assert(found !== undefined, `${key}/${season} must be configured`);
  return found;
}

async function gamedaysOf(fixture: string): Promise<readonly UpstreamGameday[]> {
  const parsed = parseSnapshot(await loadFixture(fixture));
  assert(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
  return parsed.value.gamedays;
}

async function officialOf(fixture: string, cfg: LeagueSeasonConfig) {
  const parsed = parseLeagueTable(await loadFixture(fixture));
  assert(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
  return { table: parsed.value, rows: mapOfficialTable(cfg, parsed.value) };
}

// ── Parity with the published tables ─────────────────────────────────────────

/**
 * FF BL's ruleset is the one the reference assumes, so our computation must reproduce the
 * published table completely. If this ever fails, either a gameday is missing from the
 * snapshot or upstream changed the league's rules — both worth knowing immediately.
 */
Deno.test('FF BL 2026: our computation reproduces the published table exactly', async () => {
  const cfg = config('ff-bl');
  const ours = computeStandings(cfg, await gamedaysOf('snapshot.league-ffbl-2026.json'));
  const { rows } = await officialOf('league-table.ff-bl-2026.json', cfg);

  const check = diffStandings(cfg, ours, rows);
  assertEquals(check.recordDifferences, [], summariseCheck(check));
  assertEquals(check.quotientDifferences, [], summariseCheck(check));
  assertEquals(check.onlyOurs, [], 'we must not invent teams');
  assertEquals(ours.length, 23);

  // Same order, too — which is what makes SQ → PD → EP the right sort for this league.
  assertEquals(ours.map((r) => r.teamId), rows.map((r) => r.teamId));
});

/**
 * DKB DFFL is why the stored standings come from upstream. Everything countable agrees; the
 * quotient cannot, because the league divides win points by a fixed 30 and weights a win by
 * the opponent's league, using configuration no public endpoint exposes.
 *
 * This test pins that split down deliberately: a record difference appearing here is a real
 * data problem, while the quotient differences are expected and must stay contained.
 */
Deno.test('DKB DFFL 2026: games and points agree, only the quotient cannot be reproduced', async () => {
  const cfg = config('dkb-dffl');
  const ours = computeStandings(cfg, await gamedaysOf('snapshot.league-dffl-2026.json'));
  const { rows } = await officialOf('league-table.dffl-2026.json', cfg);

  const check = diffStandings(cfg, ours, rows);
  assertEquals(check.recordDifferences, [], summariseCheck(check));
  assertEquals(check.onlyOurs, [], 'we must not invent teams');
  assertEquals(ours.length, 16);

  assert(
    check.quotientDifferences.length > 0,
    'if the quotients ever line up, the stored source can go back to our own computation',
  );
});

Deno.test('the playoff gamedays are what make DKB DFFL agree on games played', async () => {
  const cfg = config('dkb-dffl');
  const gamedays = await gamedaysOf('snapshot.league-dffl-2026.json');
  const { rows } = await officialOf('league-table.dffl-2026.json', cfg);

  assertEquals(cfg.excludeGamedayIds, [887, 888]);

  // Counting them puts every team above the published number of games.
  const withPlayoffs = computeStandings({ ...cfg, excludeGamedayIds: [] }, gamedays);
  const inflated = diffStandings(cfg, withPlayoffs, rows)
    .recordDifferences.filter((d) => d.field === 'sp');
  assert(inflated.length > 0, 'excluding 887/888 must actually matter');
  assert(inflated.every((d) => d.ours > d.official));
});

// ── Rules we own ─────────────────────────────────────────────────────────────

Deno.test('only finished games count towards the table', async () => {
  const cfg = config('ff-bl');
  const gamedays = await gamedaysOf('snapshot.league-ffbl-2026.json');

  // Three FF BL games sit abandoned in "2. Halbzeit" with scores entered. `final_score` is an
  // object for them, not null, so the reference's guard never fires and they get counted.
  const abandoned = gamedays.flatMap((gd) =>
    gd.games.filter((g) =>
      g.status !== 'beendet' && g.results.length === 2 &&
      g.results.every((r) => r.pa !== null)
    )
  );
  assertEquals(abandoned.length, 3, 'the fixture should still contain the abandoned games');

  const { rows } = await officialOf('league-table.ff-bl-2026.json', cfg);
  const ours = computeStandings(cfg, gamedays);
  assertEquals(diffStandings(cfg, ours, rows).recordDifferences, []);
});

Deno.test('unplayed games are skipped rather than counted as draws', () => {
  const cfg = config('ff-bl');
  const gameday: UpstreamGameday = {
    id: 1,
    name: 'FF BL Spieltag',
    date: '2026-06-20',
    start: '10:00',
    league: 18,
    league_display: 'FF BL',
    season: 6,
    season_display: '2026',
    address: null,
    status: 'PUBLISHED',
    games: [{
      id: 1,
      gameday: 1,
      scheduled: '10:00:00',
      field: 1,
      stage: null,
      standing: null,
      status: 'Geplant',
      results: [
        { team_id: 287, team_name: 'Nürn2', fh: null, sh: null, pa: null, isHome: true },
        { team_id: 223, team_name: 'Königsbrunn', fh: null, sh: null, pa: null, isHome: false },
      ],
      log: null,
    }],
  };

  assertEquals(computeStandings(cfg, [gameday]), []);
});

Deno.test('the winner is the side with the lower points-against', () => {
  const cfg = config('ff-bl');
  const gameday: UpstreamGameday = {
    id: 1,
    name: 'FF BL Spieltag',
    date: '2026-06-20',
    start: '10:00',
    league: 18,
    league_display: 'FF BL',
    season: 6,
    season_display: '2026',
    address: null,
    status: 'PUBLISHED',
    games: [{
      id: 1,
      gameday: 1,
      scheduled: '10:00:00',
      field: 1,
      stage: null,
      standing: null,
      status: 'beendet',
      results: [
        // Home scored 20 (so conceded 13), away scored 13.
        { team_id: 287, team_name: 'Nürn2', fh: 13, sh: 7, pa: 13, isHome: true },
        { team_id: 223, team_name: 'Kö', fh: 6, sh: 7, pa: 20, isHome: false },
      ],
      log: null,
    }],
  };

  const rows = computeStandings(cfg, [gameday]);
  const home = rows.find((r) => r.teamId === 287);
  const away = rows.find((r) => r.teamId === 223);
  assert(home !== undefined && away !== undefined);

  assertEquals(home.s, 1);
  assertEquals(home.n, 0);
  assertEquals(home.ep, 20, 'points scored is the opponent’s points-against');
  assertEquals(home.gp, 13);
  assertEquals(home.pd, 7);
  assertEquals(home.sq, 1);

  assertEquals(away.s, 0);
  assertEquals(away.n, 1);
  assertEquals(away.ep, 13);
  assertEquals(away.gp, 20);
  assertEquals(away.sq, 0);
});

Deno.test('a draw counts half a win towards the quotient', () => {
  const cfg = config('ff-bl');
  const draw = (id: number): UpstreamGameday => ({
    id,
    name: 'FF BL Spieltag',
    date: '2026-06-20',
    start: '10:00',
    league: 18,
    league_display: 'FF BL',
    season: 6,
    season_display: '2026',
    address: null,
    status: 'PUBLISHED',
    games: [{
      id,
      gameday: id,
      scheduled: '10:00:00',
      field: 1,
      stage: null,
      standing: null,
      status: 'beendet',
      results: [
        { team_id: 287, team_name: 'A', fh: 7, sh: 7, pa: 14, isHome: true },
        { team_id: 223, team_name: 'B', fh: 7, sh: 7, pa: 14, isHome: false },
      ],
      log: null,
    }],
  });

  const rows = computeStandings(cfg, [draw(1)]);
  assertEquals(rows[0].u, 1);
  assertEquals(rows[0].sq, 0.5);
});

Deno.test('a gameday from another league or another season is ignored', async () => {
  const cfg = config('ff-bl');
  // The DKB DFFL fixture contains no FF BL gamedays at all.
  assertEquals(computeStandings(cfg, await gamedaysOf('snapshot.league-dffl-2026.json')), []);

  // And a 2025 FF BL gameday must not count towards 2026.
  const gamedays = await gamedaysOf('snapshot.league-ffbl-2026.json');
  const shifted = gamedays.map((gd) => ({ ...gd, date: gd.date.replace('2026', '2025') }));
  assertEquals(computeStandings(cfg, shifted), []);
});

// ── The stored rows ──────────────────────────────────────────────────────────

Deno.test('promotion-restricted teams are flagged, and only those', async () => {
  const cfg = config('ff-bl');
  const { rows } = await officialOf('league-table.ff-bl-2026.json', cfg);

  const flagged = rows.filter((r) => r.promotionRestricted).map((r) => r.teamId).sort();
  assertEquals(flagged, [254, 492, 505]);

  // Our own team is not restricted, and the flag is per league season.
  assertEquals(rows.find((r) => r.teamId === 287)?.promotionRestricted, false);
});

Deno.test('teams with no games are left out of the stored table', async () => {
  const cfg = config('ff-bl');
  const { table, rows } = await officialOf('league-table.ff-bl-2026.json', cfg);

  const initial = table.standing.filter((r) => r.games_played === 0);
  assertEquals(initial.length, 4, 'the fixture should still contain "Initial" rows');
  assert(rows.every((r) => r.sp > 0));
  assertEquals(rows.length, table.standing.length - initial.length);
});

Deno.test('rank follows the published order rather than being recomputed', async () => {
  const cfg = config('dkb-dffl');
  const { table, rows } = await officialOf('league-table.dffl-2026.json', cfg);

  assertEquals(rows.map((r) => r.rank), rows.map((_, i) => i + 1));
  assertEquals(
    rows.map((r) => r.teamId),
    table.standing.filter((r) => r.games_played > 0).map((r) => r.team_id),
  );
  assertEquals(rows.every((r) => r.mode === 'official'), true);
});

// ── Address normalisation ────────────────────────────────────────────────────

Deno.test('placeholder addresses become null and real ones survive', () => {
  for (const placeholder of ['', '   ', 'tba', 'TBD', 'Adresse folgt', 'Adresse folgt in der Einladung']) {
    assertEquals(normaliseAddress(placeholder), null, `${JSON.stringify(placeholder)} should be dropped`);
  }
  assertEquals(normaliseAddress(null), null);

  assertEquals(normaliseAddress('Königsbrunn'), 'Königsbrunn');
  assertEquals(normaliseAddress('München-Riem'), 'München-Riem');
  assertEquals(
    normaliseAddress(' Hofer Straße 30, 90411 Nürnberg '),
    'Hofer Straße 30, 90411 Nürnberg',
  );
});
