import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { findLeagueSeason, normaliseAddress, type LeagueSeasonConfig } from './config.ts';
import {
  parseLeagueTable,
  parseSnapshot,
  parseStandings,
  type UpstreamGameday,
  type UpstreamStandingsBlock,
} from './schema.ts';
import {
  computeStandings,
  mapOfficialTable,
  mapSnapshotStandings,
  standingsOutcome,
  standingsYear,
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

// ── Rules we own ─────────────────────────────────────────────────────────────

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

// ── Standings from the snapshot ──────────────────────────────────────────────

const STANDINGS_2026 = 'snapshot.standings-teams-159-287-2026.json';
const STANDINGS_2027 = 'snapshot.standings-teams-159-287-2027-empty.json';

async function snapshotBlocks(fixture: string): Promise<readonly UpstreamStandingsBlock[]> {
  const parsed = parseStandings(await loadFixture(fixture));
  assert(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
  return parsed.value;
}

Deno.test('the snapshot tables map onto our rows with upstream rank and group', async () => {
  const blocks = await snapshotBlocks(STANDINGS_2026);
  const rows = mapSnapshotStandings(blocks);

  const dffl = rows.filter((r) => r.leagueKey === 'dkb-dffl');
  assertEquals(dffl.map((r) => r.rank), Array.from({ length: 16 }, (_, i) => i + 1));
  assert(dffl.every((r) => r.group === 'Gruppe 1'));

  const ffbl = rows.filter((r) => r.leagueKey === 'ff-bl');
  assertEquals(ffbl.map((r) => r.rank), Array.from({ length: 23 }, (_, i) => i + 1));
  assert(ffbl.every((r) => r.group === 'FF BL'));

  assert(rows.every((r) => r.season === '2026' && r.mode === 'official'));

  const source = blocks[0].rows[0];
  const first = dffl[0];
  assertEquals(first.teamId, source.team_id);
  assertEquals(
    [first.sp, first.s, first.u, first.n, first.ep, first.gp, first.pd, first.sq],
    [
      source.games_played,
      source.wins,
      source.draws,
      source.losses,
      source.pf,
      source.pa,
      source.diff,
      source.win_quotient,
    ],
  );
});

Deno.test('teams with no games are left out, so the Initial group ranks never collide', async () => {
  const rows = mapSnapshotStandings(await snapshotBlocks(STANDINGS_2026));
  const ffbl = rows.filter((r) => r.leagueKey === 'ff-bl');

  assert(!ffbl.some((r) => r.teamId === 255), 'team 255 has no games');
  assert(!rows.some((r) => r.group === 'Initial'));
  assert(rows.every((r) => r.sp > 0));
  assertEquals(new Set(ffbl.map((r) => r.rank)).size, ffbl.length);
});

Deno.test('promotion-restricted teams are flagged in the snapshot tables, and only those', async () => {
  const rows = mapSnapshotStandings(await snapshotBlocks(STANDINGS_2026));

  const flagged = rows.filter((r) => r.promotionRestricted);
  assertEquals(flagged.map((r) => `${r.leagueKey}:${r.teamId}`).sort(), [
    'ff-bl:254',
    'ff-bl:492',
    'ff-bl:505',
  ]);
  assertEquals(rows.find((r) => r.teamId === 287)?.promotionRestricted, false);
});

Deno.test('a league we do not show is skipped', async () => {
  const [block] = await snapshotBlocks(STANDINGS_2026);
  const other = { ...block, league: { id: 99, slug: 'bayernpokal', name: 'Bayernpokal' } };
  assertEquals(mapSnapshotStandings([other]), []);
});

Deno.test('a team listed twice in one table is stored once', async () => {
  const [block] = await snapshotBlocks(STANDINGS_2026);
  const twice = { ...block, rows: [block.rows[0], block.rows[0], block.rows[1]] };

  const rows = mapSnapshotStandings([twice]);
  assertEquals(rows.map((r) => r.teamId), [block.rows[0].team_id, block.rows[1].team_id]);
});

Deno.test('the table year follows the newest stored gameday, not the clock', () => {
  assertEquals(standingsYear('2026-10-04', '2027-01-15'), 2026);
  assertEquals(standingsYear(null, '2027-01-15'), 2027);
  assertEquals(standingsYear('2027-04-10', '2026-12-01'), 2027);
});

Deno.test('an empty standings payload keeps the stored tables and still counts as a success', async () => {
  const blocks = await snapshotBlocks(STANDINGS_2027);
  assertEquals(standingsOutcome(mapSnapshotStandings(blocks)), { kind: 'kept' });
});

Deno.test('the snapshot tables are written per league season', async () => {
  const outcome = standingsOutcome(mapSnapshotStandings(await snapshotBlocks(STANDINGS_2026)));

  assertEquals(outcome.kind, 'write');
  if (outcome.kind !== 'write') return;
  assertEquals(outcome.tables.map((t) => [t.leagueKey, t.season, t.rows.length]), [
    ['dkb-dffl', '2026', 16],
    ['ff-bl', '2026', 23],
  ]);
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
