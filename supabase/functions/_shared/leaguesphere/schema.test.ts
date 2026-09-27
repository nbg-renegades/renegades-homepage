import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { parseLeagueTable, parseLiveticker, parseSnapshot } from './schema.ts';
import { loadFixture } from './__fixtures__/load.ts';

/** Deep-clones a fixture so a test can corrupt one field without affecting the others. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

// ── Every recording parses ───────────────────────────────────────────────────

Deno.test('every recorded snapshot parses', async () => {
  const fixtures = [
    'snapshot.teams-159-287.json',
    'snapshot.league-ffbl-2026.json',
    'snapshot.league-dffl-2026.json',
    'snapshot.status-draft-empty.json',
    'snapshot.synthetic-draft-gameday.json',
    'snapshot.synthetic-empty-status-gameday.json',
  ];
  for (const name of fixtures) {
    const result = parseSnapshot(await loadFixture(name));
    assert(result.ok, `${name}: ${result.ok ? '' : result.errors.join('; ')}`);
  }
});

Deno.test('the empty DRAFT response is valid, not an error', async () => {
  const result = parseSnapshot(await loadFixture('snapshot.status-draft-empty.json'));
  assert(result.ok);
  assertEquals(result.value.gamedays, []);
});

Deno.test('a gameday whose status is the empty string is accepted', async () => {
  const result = parseSnapshot(await loadFixture('snapshot.synthetic-empty-status-gameday.json'));
  assert(result.ok);
  // "" is a real value upstream that no status filter can select, so it must not be rejected
  // as a missing field.
  assertEquals(result.value.gamedays[0].status, '');
});

Deno.test('both liveticker recordings and both league tables parse', async () => {
  for (const name of ['liveticker.default-5-ticks.json', 'liveticker.get-all-ticks-for.json']) {
    const result = parseLiveticker(await loadFixture(name));
    assert(result.ok, `${name}: ${result.ok ? '' : result.errors.join('; ')}`);
    assert(result.value.length > 0);
  }
  for (const name of ['league-table.ff-bl-2026.json', 'league-table.dffl-2026.json']) {
    const result = parseLeagueTable(await loadFixture(name));
    assert(result.ok, `${name}: ${result.ok ? '' : result.errors.join('; ')}`);
    assert(result.value.standing.length > 0);
  }
});

// ── Rejection ────────────────────────────────────────────────────────────────

/**
 * Hard constraint 4: a shape change upstream must be reported, not written. Each case below
 * is a plausible upstream edit, and the point of every one is that `ok` is false — the sync
 * then keeps the last good data instead of overwriting it with something it misunderstood.
 */
Deno.test('a renamed or retyped field is rejected rather than silently dropped', async () => {
  const good = await loadFixture('snapshot.teams-159-287.json') as Record<string, unknown>;

  const cases: readonly [string, (s: Record<string, unknown>) => void, string][] = [
    ['gamedays is not an array', (s) => { s['gamedays'] = {}; }, 'snapshot.gamedays'],
    ['generated_at missing', (s) => { delete s['generated_at']; }, 'generated_at'],
    ['gameday id became a string', (s) => {
      (asGamedays(s)[0] as Record<string, unknown>)['id'] = '645';
    }, '.id'],
    ['date lost its format', (s) => {
      (asGamedays(s)[0] as Record<string, unknown>)['date'] = '09.05.2026';
    }, '.date'],
    ['league_display was renamed', (s) => {
      delete (asGamedays(s)[0] as Record<string, unknown>)['league_display'];
    }, 'league_display'],
    ['game status became null', (s) => {
      (firstGame(s) as Record<string, unknown>)['status'] = null;
    }, '.status'],
    ['game status became empty', (s) => {
      (firstGame(s) as Record<string, unknown>)['status'] = '';
    }, '.status'],
    ['results became an object', (s) => {
      (firstGame(s) as Record<string, unknown>)['results'] = {};
    }, '.results'],
    ['isHome disappeared', (s) => {
      delete (firstResult(s) as Record<string, unknown>)['isHome'];
    }, '.isHome'],
    ['pa became a string', (s) => {
      (firstResult(s) as Record<string, unknown>)['pa'] = '32';
    }, '.pa'],
    ['a log score became a string', (s) => {
      (firstLogHalf(s) as Record<string, unknown>)['score'] = '28';
    }, '.score'],
    ['log entries became an object', (s) => {
      (firstLogHalf(s) as Record<string, unknown>)['entries'] = {};
    }, '.entries'],
    ['a log entry lost its sequence', (s) => {
      delete (firstLogEntry(s) as Record<string, unknown>)['sequence'];
    }, '.sequence'],
    ['a player number became a name', (s) => {
      (firstLogEntry(s) as Record<string, unknown>)['td'] = 'Meier';
    }, '.td'],
  ];

  for (const [label, corrupt, expectedPath] of cases) {
    const broken = clone(good);
    corrupt(broken);
    const result = parseSnapshot(broken);
    assert(!result.ok, `${label}: should have been rejected`);
    assertStringIncludes(
      result.errors.join('\n'),
      expectedPath,
      `${label}: the error should name the offending field`,
    );
  }
});

Deno.test('a snapshot that is not an object at all is rejected', () => {
  for (const value of [null, undefined, 42, 'nope', []]) {
    assert(!parseSnapshot(value).ok, `${JSON.stringify(value)} should be rejected`);
  }
});

Deno.test('an unknown extra field is ignored, not treated as a breakage', async () => {
  const good = await loadFixture('snapshot.teams-159-287.json') as Record<string, unknown>;
  const extended = clone(good);
  extended['brand_new_key'] = { anything: true };
  (asGamedays(extended)[0] as Record<string, unknown>)['weather'] = 'sunny';

  // Upstream adding a field must not take the results page down.
  const result = parseSnapshot(extended);
  assert(result.ok, result.ok ? '' : result.errors.join('; '));
});

Deno.test('a liveticker tick with an unexpected team value is rejected', async () => {
  const good = await loadFixture('liveticker.default-5-ticks.json') as unknown[];

  const brokenTeam = clone(good);
  ((brokenTeam[0] as Record<string, unknown>)['ticks'] as Record<string, unknown>[])[0]['team'] = 'guest';
  const result = parseLiveticker(brokenTeam);
  assert(!result.ok);
  assertStringIncludes(result.errors.join('\n'), '.team');

  const brokenScore = clone(good);
  ((brokenScore[0] as Record<string, unknown>)['home'] as Record<string, unknown>)['score'] = '39';
  assert(!parseLiveticker(brokenScore).ok);
});

Deno.test('a league table row missing a column is rejected', async () => {
  const good = await loadFixture('league-table.ff-bl-2026.json') as Record<string, unknown>;

  for (const column of ['team_id', 'games_played', 'win_quotient', 'pf', 'team__description']) {
    const broken = clone(good);
    delete ((broken['standing'] as Record<string, unknown>[])[0])[column];
    const result = parseLeagueTable(broken);
    assert(!result.ok, `a table without ${column} should be rejected`);
    assertStringIncludes(result.errors.join('\n'), column);
  }
});

Deno.test('an error response body is rejected rather than read as data', async () => {
  // Recorded 400/404 bodies. A caller that ignored the status code must still not get rows.
  assert(!parseSnapshot(await loadFixture('snapshot.error-unknown-season-pk.json')).ok);
  assert(!parseSnapshot(await loadFixture('snapshot.error-unknown-status.json')).ok);
  assert(!parseLeagueTable(await loadFixture('league-table.error-unknown-league.json')).ok);
});

Deno.test('every error names a path, so a failure is actionable from the logs alone', () => {
  const result = parseSnapshot({ generated_at: 'now', gamedays: [{ id: 'x' }] });
  assert(!result.ok);
  assert(result.errors.length > 0);
  for (const error of result.errors) {
    assertStringIncludes(error, 'snapshot.');
    assert(error.includes(': '), `"${error}" should read as "path: reason"`);
  }
});

// ── Field-level details worth pinning ────────────────────────────────────────

Deno.test('a null player survives parsing as null, not as absent', async () => {
  const parsed = parseSnapshot(await loadFixture('snapshot.teams-159-287.json'));
  assert(parsed.ok);
  const game = parsed.value.gamedays.find((g) => g.id === 645)?.games.find((g) => g.id === 7374);
  assert(game?.log != null);

  // `{"sequence": 8, "td": 3, "pat1": null}`: the attempt happened and failed. If parsing
  // dropped the key, a failed try would be indistinguishable from no try at all.
  const entry = game.log.home.firsthalf.entries.find((e) => e.sequence === 8);
  assert(entry !== undefined);
  assertEquals(entry.players['td'], 3);
  assert('pat1' in entry.players);
  assertEquals(entry.players['pat1'], null);
});

Deno.test('a possession marker keeps its name and carries no players', async () => {
  const parsed = parseSnapshot(await loadFixture('snapshot.teams-159-287.json'));
  assert(parsed.ok);
  const game = parsed.value.gamedays.find((g) => g.id === 645)?.games.find((g) => g.id === 7374);
  assert(game?.log != null);

  const marker = game.log.home.firsthalf.entries.find((e) => e.cop === true);
  assert(marker !== undefined);
  assertEquals(marker.name, 'Interception');
  assertEquals(Object.keys(marker.players), []);
});

Deno.test('a snapshot without include=games yields gamedays with no games', () => {
  const parsed = parseSnapshot({
    generated_at: '2026-09-27T16:30:30.481417+00:00',
    gamedays: [{
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
    }],
  });
  assert(parsed.ok);
  assertEquals(parsed.value.gamedays[0].games, []);
});

// ── Fixture navigation helpers ───────────────────────────────────────────────

function asGamedays(snapshot: Record<string, unknown>): unknown[] {
  return snapshot['gamedays'] as unknown[];
}

function firstGame(snapshot: Record<string, unknown>): unknown {
  const gameday = asGamedays(snapshot)[0] as Record<string, unknown>;
  return (gameday['games'] as unknown[])[0];
}

function firstResult(snapshot: Record<string, unknown>): unknown {
  return ((firstGame(snapshot) as Record<string, unknown>)['results'] as unknown[])[0];
}

function firstLogHalf(snapshot: Record<string, unknown>): unknown {
  const log = (firstGame(snapshot) as Record<string, unknown>)['log'] as Record<string, unknown>;
  return (log['home'] as Record<string, unknown>)['firsthalf'];
}

function firstLogEntry(snapshot: Record<string, unknown>): unknown {
  return ((firstLogHalf(snapshot) as Record<string, unknown>)['entries'] as unknown[])[0];
}
