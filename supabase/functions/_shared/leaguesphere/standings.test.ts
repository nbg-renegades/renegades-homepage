import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { findLeagueSeason, normaliseAddress, type LeagueSeasonConfig } from './config.ts';
import { parseLeagueTable, parseStandings, type UpstreamStandingsBlock } from './schema.ts';
import {
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

async function officialOf(fixture: string, cfg: LeagueSeasonConfig) {
  const parsed = parseLeagueTable(await loadFixture(fixture));
  assert(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
  return { table: parsed.value, rows: mapOfficialTable(cfg, parsed.value) };
}

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
